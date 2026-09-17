/**
 * Typing mouse-cursor hide — shared by home / dual / room.
 *
 * Chrome often keeps the old pointer glyph until a real mouse move or a
 * visibility change when only CSS cursor:none is toggled. A full-viewport
 * shield under the pointer forces an immediate cursor refresh on first key.
 */
(function (global) {
    'use strict';

    var STYLE_ATTR = 'data-usertypo-typing-cursor';
    var SHIELD_ID = 'usertypo-cursor-shield';
    var CLASS_NAME = 'hide-mouse-cursor';
    var MOUSE_REVEAL_MIN_PX = 8;
    var MOUSE_REVEAL_IDLE_MS = 650;

    var styleEl = null;
    var shieldEl = null;
    var hidden = false;
    var lastTypingActivityAt = 0;
    var lastMouseX = null;
    var lastMouseY = null;
    var revealOriginX = null;
    var revealOriginY = null;
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
            'body.' + CLASS_NAME + ' *,',
            '#' + SHIELD_ID + ' {',
            '  cursor: none !important;',
            '}',
            '#' + SHIELD_ID + ' {',
            '  position: fixed;',
            '  inset: 0;',
            '  z-index: 2147483646;',
            '  background: transparent;',
            '  pointer-events: auto;',
            '}',
        ].join('\n');
        return styleEl;
    }

    function mountStyleLast() {
        var el = ensureStyleEl();
        var parent = document.body || document.documentElement;
        if (!parent) return;
        parent.appendChild(el);
    }

    function ensureShield() {
        if (shieldEl && shieldEl.isConnected) return shieldEl;
        shieldEl = document.getElementById(SHIELD_ID);
        if (shieldEl) return shieldEl;
        shieldEl = document.createElement('div');
        shieldEl.id = SHIELD_ID;
        shieldEl.setAttribute('aria-hidden', 'true');
        shieldEl.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483646',
            'background:transparent',
            'pointer-events:auto',
            'cursor:none',
        ].join(';');
        return shieldEl;
    }

    function mountShield() {
        if (!document.body) return;
        var el = ensureShield();
        // Re-append so it sits on top and Chrome re-evaluates the cursor target.
        document.body.appendChild(el);
        el.style.setProperty('cursor', 'none', 'important');
        // Force a layout pass so the pointer glyph refreshes on first hide.
        void el.offsetWidth;
    }

    function removeShield() {
        if (shieldEl && shieldEl.parentNode) {
            shieldEl.parentNode.removeChild(shieldEl);
        }
        var orphan = document.getElementById(SHIELD_ID);
        if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
        shieldEl = null;
    }

    function forceTargetCursor(el) {
        if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
        if (el.id === SHIELD_ID) return;
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
        mountShield();
        revealOriginX = lastMouseX;
        revealOriginY = lastMouseY;
    }

    function show() {
        if (!hidden && !document.documentElement.classList.contains(CLASS_NAME)) {
            removeShield();
            return;
        }
        hidden = false;
        lastTypingActivityAt = 0;
        removeShield();
        document.documentElement.classList.remove(CLASS_NAME);
        if (document.body) document.body.classList.remove(CLASS_NAME);
        document.documentElement.style.removeProperty('cursor');
        if (document.body) document.body.style.removeProperty('cursor');
        clearTouchedCursors();
    }

    function noteTypingActivity() {
        lastTypingActivityAt = performance.now();
        if (!hidden) hide();
        else {
            mountStyleLast();
            mountShield();
        }
    }

    function shouldRevealFromMouseMove(e) {
        if (!e) return false;
        if (performance.now() - lastTypingActivityAt < MOUSE_REVEAL_IDLE_MS) {
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            return false;
        }
        var originX = revealOriginX != null ? revealOriginX : lastMouseX;
        var originY = revealOriginY != null ? revealOriginY : lastMouseY;
        if (originX == null || originY == null) {
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            revealOriginX = e.clientX;
            revealOriginY = e.clientY;
            return false;
        }
        var dx = e.clientX - originX;
        var dy = e.clientY - originY;
        if ((dx * dx + dy * dy) < (MOUSE_REVEAL_MIN_PX * MOUSE_REVEAL_MIN_PX)) {
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            return false;
        }
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        return true;
    }

    function trackMouse(e) {
        if (!e) return;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }

    function onMouseOver(e) {
        if (!hidden) return;
        forceTargetCursor(e.target);
    }

    function onMouseMove(e) {
        trackMouse(e);
        if (!hidden) return;
        forceTargetCursor(e.target);
        if (!shouldRevealFromMouseMove(e)) return;
        show();
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

    function onVisibilityChange() {
        if (document.hidden || !hidden) return;
        // Tab focus refreshes the cursor; remount shield so first-load state stays hidden.
        mountStyleLast();
        mountShield();
    }

    function installGlobalListeners() {
        if (autoWired) return;
        autoWired = true;
        document.addEventListener('keydown', onKeyDownCapture, true);
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('visibilitychange', onVisibilityChange);
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
