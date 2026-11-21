/**
 * Opt-in on-device debug log (for phones without dev tools).
 *
 * Turn on:  open any page with ?debug=1   (remembered on this device)
 * Turn off: open any page with ?debug=0, or press "Off" in the panel
 *
 * Records page loads, navigations, JS errors, failed scripts/styles, automatic
 * reloads and pages that ended without unloading (usually a browser-tab crash).
 * Entries live in localStorage so they survive reloads and crashes; a small
 * "LOG" button opens the list so it can be screenshotted.
 */
(function (global) {
    'use strict';

    var FLAG_KEY = 'usertypo_debug';
    var LOG_KEY = 'usertypo_debug_log';
    var ALIVE_KEY = 'usertypo_debug_alive';
    var MAX_ENTRIES = 80;

    function store() {
        try { return global.localStorage; } catch (_) { return null; }
    }

    var ls = store();
    var enabled = false;
    try {
        var param = new URLSearchParams(global.location.search).get('debug');
        if (param === '1' && ls) ls.setItem(FLAG_KEY, '1');
        if (param === '0' && ls) ls.removeItem(FLAG_KEY);
        enabled = !!(ls && ls.getItem(FLAG_KEY) === '1');
    } catch (_) { /* ignore */ }

    function readLog() {
        try { return JSON.parse((ls && ls.getItem(LOG_KEY)) || '[]') || []; } catch (_) { return []; }
    }

    function add(type, detail) {
        if (!enabled || !ls) return;
        try {
            var log = readLog();
            log.push({
                t: new Date().toISOString().slice(11, 23),
                type: String(type),
                detail: String(detail == null ? '' : detail).slice(0, 400),
                path: global.location.pathname + global.location.search,
            });
            if (log.length > MAX_ENTRIES) log = log.slice(log.length - MAX_ENTRIES);
            ls.setItem(LOG_KEY, JSON.stringify(log));
        } catch (_) { /* storage full / blocked */ }
        if (panelList) renderPanel();
    }

    // Diagnostic: ?nofx=1 turns off blurs, filters, masks and animations (remembered;
    // ?nofx=0 to undo). Tells us whether a crash is caused by visual effects.
    var NOFX_KEY = 'usertypo_debug_nofx';
    var nofx = false;
    try {
        var fxParam = new URLSearchParams(global.location.search).get('nofx');
        if (fxParam === '1' && ls) ls.setItem(NOFX_KEY, '1');
        if (fxParam === '0' && ls) ls.removeItem(NOFX_KEY);
        nofx = !!(ls && ls.getItem(NOFX_KEY) === '1');
    } catch (_) { /* ignore */ }
    if (nofx) {
        var fxStyle = document.createElement('style');
        fxStyle.id = 'usertypo-debug-nofx';
        fxStyle.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;'
            + 'filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;'
            + 'mask-image:none!important;-webkit-mask-image:none!important;will-change:auto!important;}';
        (document.head || document.documentElement).appendChild(fxStyle);
    }

    // Diagnostic: ?hide=orbit,cta,... hides parts of the room page; ?nolock=1 disables the
    // full-height typing scroll lock (room/dual). Both remembered; ?hide= / ?nolock=0 clear.
    var HIDE_KEY = 'usertypo_debug_hide';
    var NOLOCK_KEY = 'usertypo_debug_nolock';
    var HIDE_GROUPS = {
        glow: '.room-bg-glow',
        orbit: '#lobby-orbit-arena',
        cta: '#lobby-view > .fixed.bottom-16',
        invite: '#invite-menu-container',
        chat: '#lobby-chat-container',
        lobby: '#lobby-view',
        header: 'header',
        footer: 'footer',
    };
    var hideList = [];
    var nolock = false;
    try {
        var qs = new URLSearchParams(global.location.search);
        if (qs.has('hide') && ls) {
            var hv = String(qs.get('hide') || '').trim();
            if (hv) ls.setItem(HIDE_KEY, hv); else ls.removeItem(HIDE_KEY);
        }
        if (qs.get('nolock') === '1' && ls) ls.setItem(NOLOCK_KEY, '1');
        if (qs.get('nolock') === '0' && ls) ls.removeItem(NOLOCK_KEY);
        hideList = String((ls && ls.getItem(HIDE_KEY)) || '').split(',')
            .map(function (x) { return x.trim(); })
            .filter(function (x) { return HIDE_GROUPS[x]; });
        nolock = !!(ls && ls.getItem(NOLOCK_KEY) === '1');
    } catch (_) { /* ignore */ }
    if (hideList.length) {
        var hideStyle = document.createElement('style');
        hideStyle.id = 'usertypo-debug-hide';
        hideStyle.textContent = hideList.map(function (k) { return HIDE_GROUPS[k]; }).join(',') + '{display:none!important;}';
        (document.head || document.documentElement).appendChild(hideStyle);
    }
    if (nolock) {
        // router.js assigns window.usertypo_lockTypingScroll later; keep it a no-op.
        try {
            Object.defineProperty(global, 'usertypo_lockTypingScroll', {
                configurable: true,
                get: function () { return function () {}; },
                set: function () { /* ignored while ?nolock=1 */ },
            });
        } catch (_) { /* ignore */ }
    }

    global.usertypoDebugLog = { add: add, enabled: enabled };
    /** Breadcrumb for locating where a page dies (no-op unless ?debug=1). */
    global.usertypoDebugStep = function (msg) { if (enabled) add('step', msg); };
    if (!enabled) return;

    // ── Crash detection: the previous page never reached pagehide ──
    var crashedLastTime = false;
    try {
        var alive = ls.getItem(ALIVE_KEY);
        if (alive) {
            var prev = JSON.parse(alive);
            crashedLastTime = true;
            add('previous-page-ended-abruptly', 'last seen ' + prev.url + ' at ' + prev.t + ' with ' + prev.nodes + ' DOM nodes (likely a tab crash or forced reload)');
        }
    } catch (_) { /* ignore */ }
    // Break crash loops while debugging: land on home instead of re-opening the page that
    // just died, and open the log so it can be read / copied.
    if (crashedLastTime && global.location.pathname !== '/') {
        try {
            add('debug-hold', 'opened home instead of ' + global.location.pathname + global.location.search);
            history.replaceState(null, '', '/');
            global.__usertypoBootPath = '/';
        } catch (_) { /* ignore */ }
    }

    function heartbeat() {
        try {
            ls.setItem(ALIVE_KEY, JSON.stringify({
                url: global.location.pathname + global.location.search,
                t: new Date().toISOString().slice(11, 23),
                nodes: document.getElementsByTagName('*').length,
            }));
        } catch (_) { /* ignore */ }
    }
    heartbeat();
    setInterval(heartbeat, 500);
    global.addEventListener('pagehide', function () {
        add('pagehide', '');
        try { ls.removeItem(ALIVE_KEY); } catch (_) { /* ignore */ }
    });
    global.addEventListener('pageshow', function () { heartbeat(); });

    add('page-load', (nofx ? '[nofx] ' : '') + (hideList.length ? '[hide=' + hideList.join(',') + '] ' : '')
        + (nolock ? '[nolock] ' : '') + '[' + global.innerWidth + 'x' + global.innerHeight + '] '
        + (navigator.userAgent || '').slice(0, 160));

    // ── Errors ──
    global.addEventListener('error', function (event) {
        var target = event && event.target;
        if (target && target !== global && target.tagName) {
            add('resource-failed', target.tagName + ' ' + (target.src || target.href || ''));
            return;
        }
        add('js-error', (event.message || 'error') + ' @ ' + (event.filename || '') + ':' + (event.lineno || 0) + ':' + (event.colno || 0));
    }, true);
    global.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason;
        add('promise-rejected', reason && (reason.stack || reason.message) || String(reason));
    });

    // ── Navigation ──
    ['pushState', 'replaceState'].forEach(function (name) {
        var original = history[name];
        if (typeof original !== 'function') return;
        history[name] = function (state, title, url) {
            add(name, url || '');
            return original.apply(this, arguments);
        };
    });
    global.addEventListener('popstate', function () { add('popstate', ''); });
    document.addEventListener('visibilitychange', function () { add('visibility', document.visibilityState); });

    // ── Panel ──
    var panel = null;
    var panelList = null;

    function renderPanel() {
        if (!panelList) return;
        var log = readLog();
        panelList.textContent = log.map(function (e) {
            return e.t + ' [' + e.type + '] ' + e.path + (e.detail ? '\n    ' + e.detail : '');
        }).join('\n') || '(empty)';
        panelList.scrollTop = panelList.scrollHeight;
    }

    function button(label, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'font:600 12px monospace;padding:6px 10px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;';
        b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
        return b;
    }

    function buildUi() {
        var toggle = button('LOG', function () {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
            renderPanel();
        });
        toggle.style.cssText += 'position:fixed;left:8px;bottom:8px;z-index:2147483647;opacity:0.85;';

        panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:48px;top:64px;z-index:2147483646;display:none;flex-direction:column;gap:6px;'
            + 'background:rgba(2,6,23,0.95);border:1px solid #334155;border-radius:12px;padding:8px;';
        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
        bar.appendChild(button('Copy', function () {
            var text = panelList.textContent;
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(function () {});
        }));
        bar.appendChild(button('Clear', function () {
            try { ls.removeItem(LOG_KEY); } catch (_) { /* ignore */ }
            renderPanel();
        }));
        bar.appendChild(button('Off', function () {
            try { ls.removeItem(FLAG_KEY); ls.removeItem(ALIVE_KEY); } catch (_) { /* ignore */ }
            enabled = false;
            toggle.remove();
            panel.remove();
        }));
        panelList = document.createElement('pre');
        panelList.style.cssText = 'flex:1;overflow:auto;margin:0;white-space:pre-wrap;word-break:break-all;font:11px/1.35 monospace;color:#cbd5e1;';
        panel.appendChild(bar);
        panel.appendChild(panelList);
        document.body.appendChild(panel);
        document.body.appendChild(toggle);
    }

    function start() {
        buildUi();
        if (crashedLastTime) {
            panel.style.display = 'flex';
            renderPanel();
        }
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
