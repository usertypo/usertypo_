/**
 * Typing mouse-cursor hide — shared by home / dual / room.
 *
 * Chrome (Chromium issue 26723) often keeps the old pointer glyph while the
 * mouse is idle. The reliable workaround: insert an overlay, THEN change the
 * cursor style on that overlay / an ancestor so Chrome schedules a refresh.
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
    var autoWired = false;
    var refreshToken = 0;

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
        return shieldEl;
    }

    /**
     * Chromium only applies a new CSS cursor after a style change on the
     * current hover target (or ancestor) that happens *after* DOM mutation.
     */
    function forceChromeCursorRefresh(shield) {
        if (!document.body || !shield) return;
        var token = ++refreshToken;

        // Step 1: overlay is already in the DOM with a non-none cursor.
        shield.style.setProperty('cursor', 'default', 'important');
        document.body.style.setProperty('cursor', 'default', 'important');
        document.documentElement.style.setProperty('cursor', 'default', 'important');
        void shield.offsetWidth;

        // Step 2: change to none so Chrome schedules a cursor update.
        shield.style.setProperty('cursor', 'none', 'important');
        document.body.style.setProperty('cursor', 'none', 'important');
        document.documentElement.style.setProperty('cursor', 'none', 'important');
        void document.body.offsetWidth;

        // Step 3: tiny layout nudge under the pointer (extra insurance).
        shield.style.transform = 'translate(1px, 0)';
        void shield.offsetWidth;
        shield.style.transform = 'translate(0, 0)';

        // Step 4: one more flip on the next frames — covers first-paint races.
        requestAnimationFrame(function () {
            if (token !== refreshToken || !hidden) return;
            document.body.style.setProperty('cursor', 'auto', 'important');
            void document.body.offsetWidth;
            document.body.style.setProperty('cursor', 'none', 'important');
            if (shieldEl) shieldEl.style.setProperty('cursor', 'none', 'important');
            requestAnimationFrame(function () {
                if (token !== refreshToken || !hidden) return;
                document.documentElement.style.setProperty('cursor', 'wait', 'important');
                void document.documentElement.offsetWidth;
                document.documentElement.style.setProperty('cursor', 'none', 'important');
                if (shieldEl) {
                    shieldEl.style.setProperty('cursor', 'none', 'important');
                    shieldEl.style.transform = 'translate(0, 1px)';
                    void shieldEl.offsetWidth;
                    shieldEl.style.transform = '';
                }
            });
        });
    }

    function mountShieldAndRefresh() {
        if (!document.body) return;
        var el = ensureShield();
        // Start as "default" so the later flip to "none" is a real style change.
        el.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483646',
            'background:transparent',
            'pointer-events:auto',
            'cursor:default',
        ].join(';');
        document.body.appendChild(el);
        forceChromeCursorRefresh(el);
    }

    function removeShield() {
        refreshToken += 1;
        if (shieldEl && shieldEl.parentNode) {
            shieldEl.parentNode.removeChild(shieldEl);
        }
        var orphan = document.getElementById(SHIELD_ID);
        if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
        shieldEl = null;
    }

    function hide() {
        hidden = true;
        lastTypingActivityAt = performance.now();
        mountStyleLast();

        // Overlay first (with default cursor), then flip styles — order matters.
        mountShieldAndRefresh();

        document.documentElement.classList.add(CLASS_NAME);
        if (document.body) document.body.classList.add(CLASS_NAME);

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
    }

    function noteTypingActivity() {
        lastTypingActivityAt = performance.now();
        if (!hidden) hide();
        else {
            mountStyleLast();
            // Re-run the Chrome refresh sequence while still hidden.
            if (shieldEl && shieldEl.isConnected) forceChromeCursorRefresh(shieldEl);
            else mountShieldAndRefresh();
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

    function onMouseMove(e) {
        trackMouse(e);
        if (!hidden) return;
        // movementX is more reliable than absolute deltas for "intentional" move
        if (
            typeof e.movementX === 'number'
            && typeof e.movementY === 'number'
            && (Math.abs(e.movementX) > MOUSE_REVEAL_MIN_PX || Math.abs(e.movementY) > MOUSE_REVEAL_MIN_PX)
            && (performance.now() - lastTypingActivityAt >= MOUSE_REVEAL_IDLE_MS)
        ) {
            show();
            try {
                global.dispatchEvent(new CustomEvent('usertypo:typing-cursor-revealed'));
            } catch (_) { /* ignore */ }
            return;
        }
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
        mountStyleLast();
        if (shieldEl && shieldEl.isConnected) forceChromeCursorRefresh(shieldEl);
        else mountShieldAndRefresh();
    }

    function installGlobalListeners() {
        if (autoWired) return;
        autoWired = true;
        document.addEventListener('keydown', onKeyDownCapture, true);
        document.addEventListener('mousemove', onMouseMove, true);
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
