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

    // The announcement waits until the loading screen (boot overlay) has gone.
    function isSiteReady() {
        var overlay = $('spa-boot-overlay');
        return !overlay || overlay.hidden === true;
    }

    // ── Links in the message ──
    // Recognises http(s)://…, www.… and bare domains like discord.gg/abc or usertypo.com/about.
    var LINK_RE = /\b(?:https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com|net|org|gg|io|dev|app|co|me|xyz|in|uk|us|tv|ly|link|site|online)(?:\/[^\s<>"']*)?)/gi;
    // Trailing punctuation usually belongs to the sentence, not the link.
    var TRAILING_RE = /[.,!?;:'"\])}>]+$/;
    var ARROW_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">'
        + '<path d="M3.5 8.5l5-5M4.5 3.5h4v4" fill="none" stroke="currentColor" stroke-width="1.6" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function toUrl(raw) {
        var href = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
        try {
            var url = new URL(href);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
            return url;
        } catch (e) {
            return null;
        }
    }

    function isSiteUrl(url) {
        var host = url.hostname.replace(/^www\./, '');
        var here = location.hostname.replace(/^www\./, '');
        return host === here;
    }

    function buildLink(label, url) {
        var a = document.createElement('a');
        a.className = 'site-announcement__link';
        a.href = url.href;
        a.textContent = label;
        if (isSiteUrl(url)) {
            // Same site: use SPA navigation when the route is known.
            a.addEventListener('click', function (e) {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                if (typeof window.navigateTo !== 'function') return;
                e.preventDefault();
                window.navigateTo(url.pathname + url.search);
            });
        } else {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
        }
        var arrow = document.createElement('span');
        arrow.className = 'site-announcement__link-arrow';
        arrow.innerHTML = ARROW_SVG;
        a.appendChild(arrow);
        return a;
    }

    /** Fill `el` with the message, turning URLs into links (text stays text — no HTML parsing). */
    function renderMessage(el, message) {
        el.textContent = '';
        var text = String(message || '');
        var last = 0;
        LINK_RE.lastIndex = 0;
        var match;
        while ((match = LINK_RE.exec(text))) {
            var raw = match[0];
            // Part of an email address (me@example.com) — leave as text.
            if (match.index > 0 && text.charAt(match.index - 1) === '@') continue;
            var trailing = raw.match(TRAILING_RE);
            if (trailing) raw = raw.slice(0, raw.length - trailing[0].length);
            var url = raw ? toUrl(raw) : null;
            if (!url) continue;
            if (match.index > last) el.appendChild(document.createTextNode(text.slice(last, match.index)));
            el.appendChild(buildLink(raw, url));
            last = match.index + raw.length;
            LINK_RE.lastIndex = last;
        }
        if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
    }

    function render() {
        var box = $('site-announcement');
        var text = $('site-announcement-text');
        if (!box || !text) return;
        var show = !!(current && current.message && current.id !== dismissedId() && isSiteReady());
        if (show) {
            renderMessage(text, current.message);
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
        window.addEventListener('usertypo:boot-overlay-hidden', render);
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
