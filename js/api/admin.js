/**
 * Admin client — allowlisted public_ids only (UI gate; Worker enforces).
 * Public API: window.usertypoAdmin
 */
(function () {
    var ADMIN_PUBLIC_IDS = ['TE2CGW6Y', 'XRMXYTTF', 'D94QTBHG'];
    var IMPERSONATE_KEY = 'usertypo_admin_impersonating';

    function adminWorkerUrl() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.admin) || {};
        return String(cfg.url || '').replace(/\/+$/, '');
    }

    function allowlist() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.admin) || {};
        var fromCfg = Array.isArray(cfg.publicIds) ? cfg.publicIds : null;
        return (fromCfg && fromCfg.length ? fromCfg : ADMIN_PUBLIC_IDS)
            .map(function (id) { return String(id || '').trim().toUpperCase(); })
            .filter(Boolean);
    }

    function normalizePublicId(value) {
        return String(value || '').trim().toUpperCase();
    }

    function isAdminPublicId(publicId) {
        var id = normalizePublicId(publicId);
        if (!id) return false;
        return allowlist().indexOf(id) >= 0;
    }

    function currentPublicId() {
        var profile = window.__USERTYPO_PROFILE__ || null;
        return normalizePublicId(profile && profile.public_id);
    }

    function isAdmin() {
        return isAdminPublicId(currentPublicId());
    }

    function getImpersonationMeta() {
        try {
            var raw = sessionStorage.getItem(IMPERSONATE_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            return data && typeof data === 'object' ? data : null;
        } catch (e) {
            return null;
        }
    }

    function setImpersonationMeta(meta) {
        try {
            if (!meta) sessionStorage.removeItem(IMPERSONATE_KEY);
            else sessionStorage.setItem(IMPERSONATE_KEY, JSON.stringify(meta));
        } catch (e) { /* ignore */ }
    }

    /**
     * Drop stale impersonation meta after the admin session returns (or user
     * re-signs in as admin while sessionStorage still says "Viewing as …").
     * That leftover key was hiding the header Admin icon even though /admin worked.
     */
    function reconcileImpersonationMeta() {
        var meta = getImpersonationMeta();
        if (!meta) return null;
        var current = currentPublicId();
        if (!current) return meta;
        var target = normalizePublicId(meta.target_public_id);
        var adminId = normalizePublicId(meta.admin_public_id);
        if (current === adminId || (isAdminPublicId(current) && current !== target)) {
            setImpersonationMeta(null);
            return null;
        }
        return meta;
    }

    function isImpersonating() {
        var meta = reconcileImpersonationMeta();
        if (!meta) return false;
        var current = currentPublicId();
        // No profile yet — keep banner until we know who is signed in.
        if (!current) return true;
        return current === normalizePublicId(meta.target_public_id);
    }

    async function getClerkBearer() {
        if (!window.usertypoDb || typeof window.usertypoDb.getClerkToken !== 'function') {
            throw new Error('auth_or_db_missing');
        }
        var token = await window.usertypoDb.getClerkToken();
        if (!token) throw new Error('missing_token');
        return token;
    }

    async function workerFetch(path, options) {
        var base = adminWorkerUrl();
        if (!base) throw new Error('admin_worker_not_configured');
        var opts = options || {};
        var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
        if (!opts.skipAuth) {
            var token = await getClerkBearer();
            headers.Authorization = 'Bearer ' + token;
        }
        if (opts.body != null && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
        var res = await fetch(base + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body != null ? opts.body : undefined,
            keepalive: !!opts.keepalive,
        });
        var data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        if (!res.ok) {
            var err = new Error((data && data.error) || ('admin_worker_' + res.status));
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    async function signInWithTicket(ticket) {
        await window.usertypoAuth.ready();
        var clerk = window.Clerk;
        if (!clerk || !clerk.client || !clerk.client.signIn) {
            throw new Error('clerk_not_ready');
        }
        if (!ticket) throw new Error('ticket_missing');

        // Always clear the active session first WITHOUT navigating away.
        // Default Clerk.signOut() can redirect to /signin and abort impersonation mid-flight
        // (looks like "signed out, nothing happened"). Actor/sign-in tickets are one-time,
        // so we must not attempt create() until the prior session is gone.
        if (clerk.session) {
            try {
                await clerk.signOut({ redirectUrl: null });
            } catch (e) {
                try { await clerk.signOut(); } catch (e2) { /* ignore */ }
            }
            await new Promise(function (resolve) { setTimeout(resolve, 350); });
        }

        var signIn = await clerk.client.signIn.create({
            strategy: 'ticket',
            ticket: ticket,
        });
        var sessionId = signIn && signIn.createdSessionId;
        if (!sessionId) {
            var status = signIn && signIn.status ? String(signIn.status) : 'unknown';
            throw new Error('ticket_sign_in_failed:' + status);
        }
        await clerk.setActive({ session: sessionId });
        return true;
    }

    function clearLocalUserCaches() {
        window.__USERTYPO_PROFILE__ = null;
        try {
            if (window.usertypoProgression && typeof window.usertypoProgression.clearCache === 'function') {
                window.usertypoProgression.clearCache();
            }
        } catch (e) { /* ignore */ }
    }

    async function impersonate(publicId) {
        if (!isAdmin()) throw new Error('forbidden');
        var data = await workerFetch(
            '/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/impersonate',
            { method: 'POST', body: '{}' },
        );
        if (!data || !data.token) throw new Error('actor_token_missing');
        if (!data.return_token) throw new Error('return_token_missing');
        if (!data.url) throw new Error('actor_url_missing');

        // Persist return info BEFORE leaving this page.
        setImpersonationMeta({
            admin_public_id: data.admin_public_id || currentPublicId(),
            admin_user_id: data.admin_user_id || null,
            return_token: data.return_token,
            target_public_id: normalizePublicId(publicId),
            target_username: data.target && (data.target.username || data.target.display_name) || publicId,
            started_at: Date.now(),
        });
        // Keep a copy of the actor ticket for the bootstrap consumer if Clerk
        // redirects without (or before) putting __clerk_ticket in the URL.
        try {
            sessionStorage.setItem('usertypo_pending_actor_ticket', data.token);
            sessionStorage.setItem('usertypo_pending_actor_at', String(Date.now()));
        } catch (e) { /* ignore */ }

        // CRITICAL: do NOT call Clerk.signOut() or client.signIn.create here.
        // signOut redirects to "/" in this Clerk setup and aborts the flow, leaving
        // the admin signed out on the home page. Visit Clerk's actor-token accept
        // URL instead — it signs out + prepares the ticket, then returns to /signin
        // with __clerk_ticket for usertypoAuth to consume.
        window.location.assign(data.url);
        return Object.assign({}, data, { redirecting: true });
    }

    async function endImpersonation() {
        var meta = getImpersonationMeta() || {};
        var ticket = meta.return_token || null;
        var lastErr = null;

        // Prefer a fresh Worker ticket when the impersonated Clerk session is still alive.
        // If the session already expired, getClerkToken() is null → skip Worker and use
        // the stored return ticket (or hard-escape below).
        try {
            var hasSession = !!(window.Clerk && window.Clerk.session);
            if (hasSession) {
                var data = await workerFetch('/impersonate/end', {
                    method: 'POST',
                    body: JSON.stringify({
                        admin_user_id: meta.admin_user_id || null,
                        admin_public_id: meta.admin_public_id || null,
                    }),
                });
                if (data && data.token) ticket = data.token;
            }
        } catch (err) {
            lastErr = err;
        }

        if (ticket) {
            try {
                await signInWithTicket(ticket);
                setImpersonationMeta(null);
                clearLocalUserCaches();
                return { ok: true, redirect: '/admin' };
            } catch (err) {
                lastErr = err;
            }
        }

        // Hard escape: expired impersonation / missing tokens — clear banner and re-login.
        setImpersonationMeta(null);
        clearLocalUserCaches();
        try {
            if (window.Clerk && typeof window.Clerk.signOut === 'function') {
                await window.Clerk.signOut();
            }
        } catch (e) { /* ignore */ }
        return {
            ok: true,
            escaped: true,
            redirect: '/signin',
            reason: (lastErr && lastErr.message) || 'session_expired',
        };
    }

    async function me() {
        return workerFetch('/me');
    }

    async function analytics() {
        return workerFetch('/analytics');
    }

    async function searchUsers(q, limit, offset) {
        var query = encodeURIComponent(String(q || '').trim());
        var lim = limit || 20;
        var off = offset || 0;
        return workerFetch('/users?q=' + query + '&limit=' + lim + '&offset=' + off);
    }

    async function listUsers(limit, offset) {
        var lim = limit || 20;
        var off = offset || 0;
        return workerFetch('/users?limit=' + lim + '&offset=' + off);
    }

    async function getUser(publicId) {
        return workerFetch('/users/' + encodeURIComponent(normalizePublicId(publicId)));
    }

    async function banUser(publicId, reason) {
        return workerFetch('/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/ban', {
            method: 'POST',
            body: JSON.stringify({ reason: reason || '' }),
        });
    }

    async function unbanUser(publicId) {
        return workerFetch('/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/unban', {
            method: 'POST',
            body: '{}',
        });
    }

    async function purgeScores(publicId) {
        return workerFetch('/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/scores', {
            method: 'DELETE',
        });
    }

    async function clearUsername(publicId) {
        return workerFetch('/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/clear-username', {
            method: 'POST',
            body: '{}',
        });
    }

    async function passwordResetToken(publicId) {
        return workerFetch('/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/password-reset', {
            method: 'POST',
            body: '{}',
        });
    }

    async function listReports(status) {
        var st = encodeURIComponent(status || 'open');
        return workerFetch('/reports?status=' + st);
    }

    async function updateReport(id, status, notes) {
        return workerFetch('/reports/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify({ status: status, notes: notes || '' }),
        });
    }

    async function createReport(payload) {
        try {
            return await workerFetch('/reports', {
                method: 'POST',
                body: JSON.stringify(payload || {}),
            });
        } catch (_) {
            return workerFetch('/reports', {
                method: 'POST',
                body: JSON.stringify(payload || {}),
                skipAuth: true,
            });
        }
    }

    function formatDuration(seconds) {
        var s = Math.max(0, Math.floor(Number(seconds) || 0));
        if (s < 60) return s + 's';
        var m = Math.floor(s / 60);
        var rem = s % 60;
        if (m < 60) return m + 'm ' + rem + 's';
        var h = Math.floor(m / 60);
        var rm = m % 60;
        return h + 'h ' + rm + 'm';
    }

    function applyLeaderboardFlagVisibility() {
        var root = document.documentElement;
        if (!root) return;
        if (isAdmin()) root.classList.add('lb-admin-flags');
        else root.classList.remove('lb-admin-flags');
    }

    function syncAdminUi() {
        var meta = reconcileImpersonationMeta();
        applyLeaderboardFlagVisibility();
        var btn = document.getElementById('header-admin-btn');
        if (btn) {
            var show = isAdmin() && !isImpersonating();
            btn.classList.toggle('hidden', !show);
            btn.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        var banner = document.getElementById('admin-impersonation-banner');
        if (banner) {
            var showBanner = !!meta && isImpersonating();
            banner.classList.toggle('hidden', !showBanner);
            banner.setAttribute('aria-hidden', showBanner ? 'false' : 'true');
            var label = document.getElementById('admin-impersonation-label');
            if (label && meta && showBanner) {
                label.textContent = 'Viewing as ' + (meta.target_username || meta.target_public_id || 'user');
            }
        }
    }

    window.usertypoAdmin = {
        allowlist: allowlist,
        isAdmin: isAdmin,
        isAdminPublicId: isAdminPublicId,
        isImpersonating: isImpersonating,
        getImpersonationMeta: getImpersonationMeta,
        me: me,
        analytics: analytics,
        searchUsers: searchUsers,
        listUsers: listUsers,
        getUser: getUser,
        banUser: banUser,
        unbanUser: unbanUser,
        purgeScores: purgeScores,
        clearUsername: clearUsername,
        passwordResetToken: passwordResetToken,
        listReports: listReports,
        updateReport: updateReport,
        createReport: createReport,
        impersonate: impersonate,
        endImpersonation: endImpersonation,
        formatDuration: formatDuration,
        syncAdminUi: syncAdminUi,
        applyLeaderboardFlagVisibility: applyLeaderboardFlagVisibility,
        workerFetch: workerFetch,
    };

    function boot() {
        syncAdminUi();
        if (window.usertypoAuth && typeof window.usertypoAuth.onChange === 'function') {
            window.usertypoAuth.onChange(function () {
                syncAdminUi();
            });
        }
        document.addEventListener('usertypo:profile', function () {
            syncAdminUi();
        });
        window.addEventListener('usertypo:profile-synced', function () {
            syncAdminUi();
        });

        var returnBtn = document.getElementById('admin-impersonation-return');
        if (returnBtn && !returnBtn.dataset.wired) {
            returnBtn.dataset.wired = '1';
            returnBtn.addEventListener('click', function () {
                if (!window.usertypoAdmin || typeof window.usertypoAdmin.endImpersonation !== 'function') return;
                if (returnBtn.dataset.busy === '1') return;
                returnBtn.dataset.busy = '1';
                returnBtn.disabled = true;
                window.usertypoAdmin.endImpersonation()
                    .then(function (result) {
                        window.location.assign((result && result.redirect) || '/admin');
                    })
                    .catch(function (err) {
                        console.error('[usertypo admin] return failed', err);
                        // Last resort if something unexpected throws: drop banner and re-auth.
                        try { sessionStorage.removeItem(IMPERSONATE_KEY); } catch (e) { /* ignore */ }
                        returnBtn.dataset.busy = '0';
                        returnBtn.disabled = false;
                        window.location.assign('/signin');
                    });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
