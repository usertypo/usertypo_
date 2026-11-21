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

    global.usertypoDebugLog = { add: add, enabled: enabled };
    if (!enabled) return;

    // ── Crash detection: the previous page never reached pagehide ──
    try {
        var alive = ls.getItem(ALIVE_KEY);
        if (alive) {
            var prev = JSON.parse(alive);
            add('previous-page-ended-abruptly', 'last seen ' + prev.url + ' at ' + prev.t + ' with ' + prev.nodes + ' DOM nodes (likely a tab crash or forced reload)');
        }
    } catch (_) { /* ignore */ }

    function heartbeat() {
        try {
            ls.setItem(ALIVE_KEY, JSON.stringify({
                url: global.location.pathname + global.location.search,
                t: new Date().toISOString().slice(11, 19),
                nodes: document.getElementsByTagName('*').length,
            }));
        } catch (_) { /* ignore */ }
    }
    heartbeat();
    setInterval(heartbeat, 2000);
    global.addEventListener('pagehide', function () {
        add('pagehide', '');
        try { ls.removeItem(ALIVE_KEY); } catch (_) { /* ignore */ }
    });
    global.addEventListener('pageshow', function () { heartbeat(); });

    add('page-load', (navigator.userAgent || '').slice(0, 160));

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

    if (document.body) buildUi();
    else document.addEventListener('DOMContentLoaded', buildUi);
})(typeof window !== 'undefined' ? window : globalThis);
