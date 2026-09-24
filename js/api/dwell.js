/**
 * Signed-in dwell tracking (time on site) via admin Worker presence endpoints.
 * Public API: window.usertypoDwell
 */
(function () {
    var timer = null;
    var INTERVAL_MS = 30000;
    var started = false;

    function adminUrl() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.admin) || {};
        return String(cfg.url || '').replace(/\/+$/, '');
    }

    function analyticsAllowed() {
        try {
            if (window.usertypoConsent && typeof window.usertypoConsent.get === 'function') {
                var c = window.usertypoConsent.get();
                if (c && c.analytics === false) return false;
            }
        } catch (e) { /* ignore */ }
        return true;
    }

    async function beat() {
        if (!adminUrl()) return;
        if (!analyticsAllowed()) return;
        if (!window.usertypoAuth || !window.usertypoAdmin) return;
        try {
            await window.usertypoAuth.ready();
            var state = window.usertypoAuth.getState();
            if (!state.isSignedIn || !state.user) return;
            await window.usertypoAdmin.workerFetch('/presence/heartbeat', {
                method: 'POST',
                body: '{}',
            });
        } catch (err) {
            console.warn('[usertypo dwell] heartbeat failed', err);
        }
    }

    function endBeacon() {
        var base = adminUrl();
        if (!base || !window.usertypoDb) return;
        window.usertypoDb.getClerkToken().then(function (token) {
            if (!token) return;
            try {
                fetch(base + '/presence/end', {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + token,
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    body: '{}',
                    keepalive: true,
                }).catch(function () { /* ignore */ });
            } catch (e) { /* ignore */ }
        }).catch(function () { /* ignore */ });
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        started = false;
    }

    function start() {
        if (!adminUrl()) return;
        stop();
        started = true;
        beat();
        timer = setInterval(function () {
            if (document.visibilityState === 'hidden') return;
            beat();
        }, INTERVAL_MS);
    }

    function onVisibility() {
        if (document.visibilityState === 'visible') {
            var state = window.usertypoAuth && window.usertypoAuth.getState();
            if (state && state.isSignedIn) {
                if (!started) start();
                else beat();
            }
        }
    }

    function bind() {
        if (!window.usertypoAuth) return;
        window.usertypoAuth.onChange(function (state) {
            if (state && state.isSignedIn && state.user) start();
            else {
                if (started) endBeacon();
                stop();
            }
        });
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', function () {
            if (started) endBeacon();
            stop();
        });
    }

    window.usertypoDwell = {
        start: start,
        stop: stop,
        beat: beat,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
