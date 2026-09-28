/**
 * Site-wide announcement box (published from the admin panel).
 * Public API: window.usertypoAnnouncement
 */
(function () {
    var DISMISS_KEY = 'usertypo_announcement_dismissed';
    var POLL_MS = 60 * 1000;
    var current = null;
    var pollTimer = null;
    var inFlight = null;

    function $(id) { return document.getElementById(id); }

    function dismissedId() {
        try { return localStorage.getItem(DISMISS_KEY) || ''; } catch (e) { return ''; }
    }

    function positionBox() {
        var box = $('site-announcement');
        if (!box) return;
        var top = 0;
        var header = document.querySelector('body > header');
        if (header) top = Math.max(top, header.getBoundingClientRect().bottom);
        var imp = $('admin-impersonation-banner');
        if (imp && !imp.classList.contains('hidden')) top = Math.max(top, imp.getBoundingClientRect().bottom);
        box.style.top = Math.max(8, Math.round(top) + 8) + 'px';
    }

    function render() {
        var box = $('site-announcement');
        var text = $('site-announcement-text');
        if (!box || !text) return;
        var show = !!(current && current.message && current.id !== dismissedId());
        if (show) {
            text.textContent = current.message;
            positionBox();
        }
        box.classList.toggle('hidden', !show);
        box.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    async function refresh() {
        if (inFlight) return inFlight;
        inFlight = (async function () {
            try {
                if (!window.usertypoDb || typeof window.usertypoDb.getClient !== 'function') return;
                var client = await window.usertypoDb.getClient();
                var result = await client.rpc('get_site_announcement');
                if (result.error) throw result.error;
                var row = Array.isArray(result.data) ? result.data[0] : result.data;
                current = row && row.id ? { id: String(row.id), message: String(row.message || '') } : null;
                render();
            } catch (err) {
                console.warn('[usertypo announcement] load failed', err);
            }
        })();
        try {
            return await inFlight;
        } finally {
            inFlight = null;
        }
    }

    function dismiss() {
        if (current) {
            try { localStorage.setItem(DISMISS_KEY, current.id); } catch (e) { /* ignore */ }
        }
        render();
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(function () {
            if (document.visibilityState === 'visible') refresh();
        }, POLL_MS);
    }

    function init() {
        var close = $('site-announcement-close');
        if (close) close.addEventListener('click', dismiss);
        window.addEventListener('resize', function () {
            if (current) positionBox();
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') refresh();
        });
        refresh();
        startPolling();
    }

    window.usertypoAnnouncement = {
        refresh: refresh,
        dismiss: dismiss,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
