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

    function isImpersonating() {
        return !!getImpersonationMeta();
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
        if (!window.Clerk || !window.Clerk.client || !window.Clerk.client.signIn) {
            throw new Error('clerk_not_ready');
        }
        var signIn = await window.Clerk.client.signIn.create({
            strategy: 'ticket',
            ticket: ticket,
        });
        if (!signIn || !signIn.createdSessionId) {
            throw new Error('ticket_sign_in_failed');
        }
        await window.Clerk.setActive({ session: signIn.createdSessionId });
        return true;
    }

    async function me() {
        return workerFetch('/me');
    }

    async function analytics() {
        return workerFetch('/analytics');
    }

    async function searchUsers(q, limit) {
        var query = encodeURIComponent(String(q || '').trim());
        var lim = limit || 20;
        return workerFetch('/users?q=' + query + '&limit=' + lim);
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
        var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
        var opts = {
            method: 'POST',
            body: JSON.stringify(payload || {}),
            headers: headers,
            skipAuth: true,
        };
        try {
            var token = await getClerkBearer();
            opts.skipAuth = false;
            opts.headers = headers;
            // workerFetch will attach auth when skipAuth is false
            return workerFetch('/reports', {
                method: 'POST',
                body: JSON.stringify(payload || {}),
            });
        } catch (_) {
            return workerFetch('/reports', opts);
        }
    }

    async function impersonate(publicId) {
        if (!isAdmin()) throw new Error('forbidden');
        var data = await workerFetch(
            '/users/' + encodeURIComponent(normalizePublicId(publicId)) + '/impersonate',
            { method: 'POST', body: '{}' },
        );
        if (!data || !data.token) throw new Error('actor_token_missing');
        setImpersonationMeta({
            admin_public_id: currentPublicId(),
            target_public_id: normalizePublicId(publicId),
            target_username: data.target && (data.target.username || data.target.display_name) || publicId,
            started_at: Date.now(),
        });
        await signInWithTicket(data.token);
        window.__USERTYPO_PROFILE__ = null;
        if (window.usertypoProgression && typeof window.usertypoProgression.clearCache === 'function') {
            window.usertypoProgression.clearCache();
        }
        return data;
    }

    async function endImpersonation() {
        var data = await workerFetch('/impersonate/end', { method: 'POST', body: '{}' });
        if (!data || !data.token) throw new Error('return_token_missing');
        setImpersonationMeta(null);
        await signInWithTicket(data.token);
        window.__USERTYPO_PROFILE__ = null;
        if (window.usertypoProgression && typeof window.usertypoProgression.clearCache === 'function') {
            window.usertypoProgression.clearCache();
        }
        return data;
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
        applyLeaderboardFlagVisibility();
        var btn = document.getElementById('header-admin-btn');
        if (btn) {
            var show = isAdmin() && !isImpersonating();
            btn.classList.toggle('hidden', !show);
            btn.setAttribute('aria-hidden', show ? 'false' : 'true');
        }
        var banner = document.getElementById('admin-impersonation-banner');
        if (banner) {
            var meta = getImpersonationMeta();
            var showBanner = !!meta;
            banner.classList.toggle('hidden', !showBanner);
            banner.setAttribute('aria-hidden', showBanner ? 'false' : 'true');
            var label = document.getElementById('admin-impersonation-label');
            if (label && meta) {
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
                returnBtn.disabled = true;
                window.usertypoAdmin.endImpersonation()
                    .then(function () {
                        if (window.navigateTo) window.navigateTo('/admin');
                        else window.location.href = '/admin';
                        window.location.reload();
                    })
                    .catch(function (err) {
                        console.error('[usertypo admin] return failed', err);
                        returnBtn.disabled = false;
                        window.alert((err && err.message) || 'Could not return to admin');
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
