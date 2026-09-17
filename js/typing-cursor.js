/**
 * Typing mouse-cursor hide — shared by home / dual / room.
 * Lives in the SPA shell (not page-fragments) so a stale home fragment
 * cannot strand users without cursor-hide, and so we can fight
 * extension CSS that overrides page styles.
 */
(function (global) {
    'use strict';

    var STYLE_ATTR = 'data-usertypo-typing-cursor';
    var CLASS_NAME = 'hide-mouse-cursor';
    var MOUSE_REVEAL_MIN_PX = 8;
    var MOUSE_REVEAL_IDLE_MS = 650;

    var styleEl = null;
    var hidden = false;
    var lastTypingActivityAt = 0;
    var lastMouseX = null;
    var lastMouseY = null;
    var touched = [];
    var autoWired = false;

    function ensureStyleEl() {
        if (styleEl && styleEl.isConnected) return styleEl;
        styleEl = document.createElement('style');
        styleEl.setAttribute(STYLE_ATTR, '1');
        styleEl.textContent = [
            'html.' + CLASS_NAME + ',',
            'html.' + CLASS_NAME + ' *,',
            'body.' + CLASS_NAME + ',',
            'body.' + CLASS_NAME + ' * {',
            '  cursor: none !important;',
            '}',
        ].join('\n');
        return styleEl;
    }

    function mountStyleLast() {
        var el = ensureStyleEl();
        var parent = document.body || document.documentElement;
        if (!parent) return;
        // Re-append so this rule wins over earlier extension/page stylesheets.
        parent.appendChild(el);
    }

    function forceTargetCursor(el) {
        if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
        el.style.setProperty('cursor', 'none', 'important');
        touched.push(el);
        if (touched.length > 250) {
            var old = touched.shift();
            try {
                if (old && old.style) old.style.removeProperty('cursor');
            } catch (_) { /* ignore */ }
        }
    }

    function clearTouchedCursors() {
        while (touched.length) {
            var el = touched.pop();
            try {
                if (el && el.style) el.style.removeProperty('cursor');
            } catch (_) { /* ignore */ }
        }
    }

    function hide() {
        hidden = true;
        lastTypingActivityAt = performance.now();
        mountStyleLast();
        document.documentElement.classList.add(CLASS_NAME);
        if (document.body) document.body.classList.add(CLASS_NAME);
        document.documentElement.style.setProperty('cursor', 'none', 'important');
        if (document.body) document.body.style.setProperty('cursor', 'none', 'important');
    }

    function show() {
        if (!hidden && !document.documentElement.classList.contains(CLASS_NAME)) return;
        hidden = false;
        lastTypingActivityAt = 0;
        document.documentElement.classList.remove(CLASS_NAME);
        if (document.body) document.body.classList.remove(CLASS_NAME);
        document.documentElement.style.removeProperty('cursor');
        if (document.body) document.body.style.removeProperty('cursor');
        clearTouchedCursors();
    }

    function noteTypingActivity() {
        lastTypingActivityAt = performance.now();
        if (!hidden) hide();
        else mountStyleLast();
    }

    function shouldRevealFromMouseMove(e) {
        if (!e) return false;
        if (performance.now() - lastTypingActivityAt < MOUSE_REVEAL_IDLE_MS) {
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            return false;
        }
        if (lastMouseX == null || lastMouseY == null) {
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            return false;
        }
        var dx = e.clientX - lastMouseX;
        var dy = e.clientY - lastMouseY;
        if ((dx * dx + dy * dy) < (MOUSE_REVEAL_MIN_PX * MOUSE_REVEAL_MIN_PX)) {
            return false;
        }
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        return true;
    }

    function onMouseOver(e) {
        if (!hidden) return;
        forceTargetCursor(e.target);
    }

    function onMouseMove(e) {
        if (!hidden) return;
        forceTargetCursor(e.target);
        if (!shouldRevealFromMouseMove(e)) return;
        show();
        // Let page zen handlers re-show chrome if they want.
        try {
            global.dispatchEvent(new CustomEvent('usertypo:typing-cursor-revealed'));
        } catch (_) { /* ignore */ }
    }

    function isTypingKey(e) {
        if (!e || e.ctrlKey || e.altKey || e.metaKey) return false;
        if (e.key === 'Backspace' || e.key === ' ' || e.key === 'Spacebar') return true;
        return !!(e.key && e.key.length === 1);
    }

    function isHomeTypingRoute() {
        var path = String(global.location && global.location.pathname || '/').replace(/\/+$/, '') || '/';
        return path === '/';
    }

    function homeSurfaceReady() {
        return !!(document.getElementById('typing-area') && document.getElementById('text-container'));
    }

    function onKeyDownCapture(e) {
        if (!isHomeTypingRoute() || !homeSurfaceReady()) return;
        if (!isTypingKey(e)) return;
        var active = document.activeElement;
        if (
            active
            && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
            && active.id !== 'mobile-typing-input'
        ) {
            return;
        }
        noteTypingActivity();
    }

    function installGlobalListeners() {
        if (autoWired) return;
        autoWired = true;
        document.addEventListener('keydown', onKeyDownCapture, true);
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseover', onMouseOver, true);
    }

    installGlobalListeners();

    global.usertypoTypingCursor = {
        hide: hide,
        show: show,
        noteTypingActivity: noteTypingActivity,
        shouldRevealFromMouseMove: shouldRevealFromMouseMove,
        isHidden: function () { return hidden; },
    };
})(typeof window !== 'undefined' ? window : globalThis);
