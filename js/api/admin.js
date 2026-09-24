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

    function clerkActorSession() {
        try {
            var session = window.Clerk && window.Clerk.session;
            return session && session.actor ? session : null;
        } catch (e) {
            return null;
        }
    }

    function clerkIsImpersonating() {
        return !!clerkActorSession();
    }

    /**
     * Drop stale impersonation meta after the admin session returns (or user
     * re-signs in as admin while sessionStorage still says "Viewing as …").
     * That leftover key was hiding the header Admin icon even though /admin worked.
     */
    function reconcileImpersonationMeta() {
        var meta = getImpersonationMeta();
        if (!meta) return null;
        // Live Clerk actor session wins — never clear meta while still impersonating.
        if (clerkIsImpersonating()) return meta;
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
        if (clerkIsImpersonating()) return true;
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

    /**
     * End the active Clerk session without navigating away.
     * clerk.signOut() / signOut({ redirectUrl: null }) still navigate (null is
     * treated as missing and afterSignOutUrl wins — often "/" or localhost).
     * The callback form skips navigation in clerk-js.
     */
    async function clearSessionStayPut(clerk) {
        if (!clerk || !clerk.session) return;
        if (typeof clerk.session.end === 'function') {
            try {
                await clerk.session.end();
                return;
            } catch (e) { /* fall through */ }
        }
        try {
            await clerk.signOut(function () { /* stay on this page */ });
        } catch (e) {
            try {
                if (clerk.session && typeof clerk.session.remove === 'function') {
                    await clerk.session.remove();
                }
            } catch (e2) { /* ignore */ }
        }
    }

    async function signInWithTicket(ticket) {
        await window.usertypoAuth.ready();
        var clerk = window.Clerk;
        if (!clerk || !clerk.client || !clerk.client.signIn) {
            throw new Error('clerk_not_ready');
        }
        if (!ticket) throw new Error('ticket_missing');

        // Clear prior session in-place, then redeem the one-time ticket once.
        await clearSessionStayPut(clerk);
        await new Promise(function (resolve) { setTimeout(resolve, 300); });

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
        if (!clerk.user) {
            throw new Error('ticket_session_inactive');
        }
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

        // Persist return info BEFORE switching sessions.
        setImpersonationMeta({
            admin_public_id: data.admin_public_id || currentPublicId(),
            admin_user_id: data.admin_user_id || null,
            return_token: data.return_token,
            target_public_id: normalizePublicId(publicId),
            target_username: data.target && (data.target.username || data.target.display_name) || publicId,
            started_at: Date.now(),
        });

        // Stay on this origin. Never open data.url — Clerk Dashboard paths still
        // point at localhost for the staging instance and dump the admin there.
        await signInWithTicket(data.token);
        clearLocalUserCaches();
        try {
            sessionStorage.removeItem('usertypo_pending_actor_ticket');
            sessionStorage.removeItem('usertypo_pending_actor_at');
        } catch (e) { /* ignore */ }

        if (typeof window.navigateTo === 'function') window.navigateTo('/');
        else window.location.assign('/');
        return data;
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
            await clearSessionStayPut(window.Clerk);
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
        var impersonating = isImpersonating();
        applyLeaderboardFlagVisibility();
        var btn = document.getElementById('header-admin-btn');
        if (btn) {
            var show = isAdmin() && !impersonating;
            btn.classList.toggle('hidden', !show);
            btn.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        var banner = document.getElementById('admin-impersonation-banner');
        if (banner) {
            // Prefer Clerk's eye control only — keep our banner hidden.
            banner.classList.add('hidden');
            banner.setAttribute('aria-hidden', 'true');
        }
    }

    function returnToAdminFromUi(triggerEl) {
        if (!window.usertypoAdmin || typeof window.usertypoAdmin.endImpersonation !== 'function') {
            return Promise.reject(new Error('admin_api_missing'));
        }
        if (triggerEl) {
            if (triggerEl.dataset.busy === '1') return Promise.resolve();
            triggerEl.dataset.busy = '1';
            if ('disabled' in triggerEl) triggerEl.disabled = true;
        }
        return window.usertypoAdmin.endImpersonation()
            .then(function (result) {
                window.location.assign((result && result.redirect) || '/admin');
            })
            .catch(function (err) {
                console.error('[usertypo admin] return failed', err);
                try { sessionStorage.removeItem(IMPERSONATE_KEY); } catch (e) { /* ignore */ }
                if (triggerEl) {
                    triggerEl.dataset.busy = '0';
                    if ('disabled' in triggerEl) triggerEl.disabled = false;
                }
                window.location.assign('/signin');
            });
    }

    function wireClerkImpersonationFab() {
        if (document.documentElement.dataset.clerkFabWired === '1') return;
        document.documentElement.dataset.clerkFabWired = '1';
        // Capture-phase: replace Clerk's default "sign out of impersonation" with return-to-admin.
        document.addEventListener('click', function (e) {
            if (!clerkIsImpersonating()) return;
            var el = e.target && e.target.closest
                ? e.target.closest(
                    '.cl-impersonationFab, .cl-impersonationFabActionLink, .cl-impersonationFabIconContainer, .cl-impersonationFabIcon, .cl-impersonationFabTitle'
                )
                : null;
            if (!el) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            returnToAdminFromUi(el);
        }, true);
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
        wireClerkImpersonationFab();
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
                returnToAdminFromUi(returnBtn);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
