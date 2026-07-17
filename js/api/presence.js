/**
 * Presence heartbeat — marks the signed-in user as online via profiles.last_seen_at.
 * Public API: window.usertypoPresence
 */
(function () {
    var timer = null;
    var INTERVAL_MS = 30000;

    async function beat() {
        if (!window.usertypoAuth || !window.usertypoDb) return;
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) return;

        try {
            var client = await window.usertypoDb.getClient();
            var result = await client.rpc('heartbeat');
            if (result.error) throw result.error;
        } catch (err) {
            console.warn('[usertypo presence] heartbeat failed', err);
        }
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function start() {
        stop();
        beat();
        timer = setInterval(beat, INTERVAL_MS);
    }

    function bind() {
        if (!window.usertypoAuth) return;
        window.usertypoAuth.onChange(function (state) {
            if (state && state.isSignedIn && state.user) start();
            else stop();
        });

        window.usertypoAuth.ready().then(function () {
            var state = window.usertypoAuth.getState();
            if (state && state.isSignedIn && state.user) start();
        });

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') beat();
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
    };
})();
