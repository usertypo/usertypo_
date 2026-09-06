/**
 * Presence heartbeat — marks the signed-in user as online via profiles.last_seen_at.
 * Clears presence on tab close so friends see offline quickly.
 * Public API: window.usertypoPresence
 */
(function () {
    var timer = null;
    var INTERVAL_MS = 15000;
    var cachedToken = null;
    var goingOffline = false;

    function supabaseConfig() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.supabase) || {};
        return {
            url: String(cfg.url || '').replace(/\/+$/, ''),
            key: cfg.anonKey || cfg.publishableKey || '',
        };
    }

    async function refreshCachedToken() {
        if (!window.usertypoDb || typeof window.usertypoDb.getClerkToken !== 'function') return null;
        try {
            cachedToken = await window.usertypoDb.getClerkToken();
        } catch (e) {
            cachedToken = null;
        }
        return cachedToken;
    }

    async function beat() {
        if (goingOffline) return;
        if (!window.usertypoAuth || !window.usertypoDb) return;
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) return;

        try {
            await refreshCachedToken();
            var client = await window.usertypoDb.getClient();
            var result = await client.rpc('heartbeat');
            if (result.error) throw result.error;
        } catch (err) {
            console.warn('[usertypo presence] heartbeat failed', err);
        }
    }

    function goOfflineBeacon() {
        var cfg = supabaseConfig();
        if (!cfg.url || !cfg.key || !cachedToken) return;
        try {
            fetch(cfg.url + '/rest/v1/rpc/go_offline', {
                method: 'POST',
                headers: {
                    apikey: cfg.key,
                    Authorization: 'Bearer ' + cachedToken,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                },
                body: '{}',
                keepalive: true,
            }).catch(function () { /* ignore unload failures */ });
        } catch (e) { /* ignore */ }
    }

    async function goOffline() {
        goingOffline = true;
        goOfflineBeacon();
        try {
            if (!window.usertypoDb) return;
            var client = await window.usertypoDb.getClient();
            await client.rpc('go_offline');
        } catch (err) {
            /* beacon is the unload path; async may not finish */
        }
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function start() {
        goingOffline = false;
        stop();
        beat();
        timer = setInterval(beat, INTERVAL_MS);
    }

    function onPageHide() {
        var state = window.usertypoAuth && window.usertypoAuth.getState();
        if (!state || !state.isSignedIn || !state.user) return;
        stop();
        goOfflineBeacon();
    }

    function bind() {
        if (!window.usertypoAuth) return;
        window.usertypoAuth.onChange(function (state) {
            if (state && state.isSignedIn && state.user) start();
            else {
                stop();
                cachedToken = null;
            }
        });

        window.usertypoAuth.ready().then(function () {
            var state = window.usertypoAuth.getState();
            if (state && state.isSignedIn && state.user) start();
        });

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                goingOffline = false;
                beat();
            }
        });

        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', function () {
            var state = window.usertypoAuth && window.usertypoAuth.getState();
            if (state && state.isSignedIn && state.user) start();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }

    window.usertypoPresence = {
        beat: beat,
        start: start,
        stop: stop,
        goOffline: goOffline,
    };
})();
