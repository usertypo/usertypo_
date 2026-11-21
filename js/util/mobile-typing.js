/**
 * Soft-keyboard typing for multiplayer races (rooms + duels) on phones/tablets.
 *
 * Same approach as the home page: a near-invisible textarea covers the typing
 * area. iOS sends real keydown events from it, which bubble to the race page's
 * document keydown handler. Android keyboards often skip keydown, so text from
 * beforeinput/input is replayed as synthetic document keydown events, and the
 * textarea's own native keydowns are swallowed to avoid double input.
 *
 * Usage (race pages):
 *   var kb = window.usertypoMobileTyping.attach({ area, isActive, signal });
 *   kb.focus();   // e.g. when the countdown ends
 */
(function (global) {
    'use strict';

    var INPUT_CLASS = 'mp-soft-keyboard-input';
    /** Keeps Android capture non-empty so delete beforeinput/input always fires. */
    var SENTINEL = '​';
    var stylesInjected = false;

    function isMobile() {
        var m = global.usertypoMobile;
        return !!(m && typeof m.isMobileClient === 'function' && m.isMobileClient());
    }

    function isAndroid() {
        var m = global.usertypoMobile;
        return !!(m && typeof m.isAndroidClient === 'function' && m.isAndroidClient());
    }

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        var style = document.createElement('style');
        style.id = 'mp-soft-keyboard-styles';
        // 16px font avoids iOS focus zoom; opacity:0 breaks Android Chrome input.
        style.textContent = '.' + INPUT_CLASS + '{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;'
            + 'border:0;resize:none;opacity:0.01;color:transparent;caret-color:transparent;background:transparent;'
            + 'outline:none;z-index:6;font-size:16px;line-height:1;overflow:hidden;-webkit-user-select:text;'
            + 'user-select:text;touch-action:manipulation;}';
        document.head.appendChild(style);
    }

    var NOOP = {
        enabled: false,
        focus: function () {},
        blur: function () {},
        destroy: function () {},
    };

    /**
     * @param {{ area: HTMLElement, isActive?: function(): boolean, signal?: AbortSignal }} options
     *   area     – positioned typing area to cover
     *   isActive – true while the race is counting down / running; the keyboard
     *              is dismissed automatically once it turns false
     *   signal   – page cleanup signal; removes the textarea when aborted
     */
    function attach(options) {
        var area = options && options.area;
        if (!area || !isMobile()) return NOOP;

        var existing = area.querySelector('.' + INPUT_CLASS);
        if (existing && existing.__usertypoSoftKeyboard) return existing.__usertypoSoftKeyboard;

        injectStyles();
        var isActive = typeof options.isActive === 'function' ? options.isActive : function () { return true; };
        var android = isAndroid();
        var dispatching = false;
        var lastBackspaceAt = 0;
        var handledByBeforeInput = false;
        var watchTimer = null;

        var input = document.createElement('textarea');
        input.className = INPUT_CLASS;
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'none');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('inputmode', 'text');
        input.setAttribute('enterkeyhint', 'done');
        input.setAttribute('aria-label', 'Type here');
        input.setAttribute('tabindex', '0');
        area.appendChild(input);

        function dispatchKey(key) {
            if (!key) return;
            if (key === 'Backspace') lastBackspaceAt = Date.now();
            dispatching = true;
            try {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
                document.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true, cancelable: true }));
            } catch (_) { /* ignore */ }
            dispatching = false;
        }

        function emitBackspace() {
            if (Date.now() - lastBackspaceAt < 40) return;
            dispatchKey('Backspace');
        }

        function feedText(text) {
            if (!text) return;
            for (var i = 0; i < text.length; i++) {
                var ch = text.charAt(i);
                if (ch === '\n' || ch === '\r' || ch === SENTINEL) continue;
                dispatchKey(ch);
            }
        }

        function armBuffer() {
            if (!android) return;
            try {
                input.value = SENTINEL;
                if (typeof input.setSelectionRange === 'function') {
                    input.setSelectionRange(SENTINEL.length, SENTINEL.length);
                }
            } catch (_) { /* ignore */ }
        }

        function clearBuffer() {
            try { input.value = ''; } catch (_) { /* ignore */ }
        }

        function stopWatching() {
            if (watchTimer) clearInterval(watchTimer);
            watchTimer = null;
        }

        function blur() {
            stopWatching();
            try { input.blur(); } catch (_) { /* ignore */ }
            clearBuffer();
        }

        // Dismiss the keyboard once the race is over (results view etc.).
        function startWatching() {
            if (watchTimer) return;
            watchTimer = setInterval(function () {
                if (!isActive()) blur();
            }, 300);
        }

        function focus() {
            if (!input.isConnected) return;
            try {
                input.focus({ preventScroll: true });
            } catch (_) {
                try { input.focus(); } catch (__) { /* ignore */ }
            }
            armBuffer();
            startWatching();
        }

        // Tapping the text focuses in the same user gesture, which reliably opens the keyboard.
        function onTap() {
            if (isActive()) focus();
        }
        area.addEventListener('pointerdown', onTap);
        area.addEventListener('click', onTap);

        // Android: the textarea's own keydowns are unreliable (Unidentified / 229) and would
        // double-insert next to the replayed input events — keep them away from the page.
        input.addEventListener('keydown', function (e) {
            if (!android || dispatching) return;
            if (e.key === 'Backspace') {
                if (Date.now() - lastBackspaceAt < 40) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                lastBackspaceAt = Date.now();
                return;
            }
            if (e.key === 'Unidentified' || e.keyCode === 229 || e.key === ' ' || e.key === 'Spacebar'
                || (e.key && e.key.length === 1)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
        input.addEventListener('keyup', function (e) {
            if (!android || dispatching) return;
            if (e.key !== 'Backspace') e.stopPropagation();
        });

        input.addEventListener('beforeinput', function (e) {
            if (!android) return;
            var type = e.inputType || '';
            if (type.indexOf('delete') === 0) {
                e.preventDefault();
                handledByBeforeInput = true;
                if (isActive()) emitBackspace();
                armBuffer();
                return;
            }
            if (type === 'insertText' || type === 'insertCompositionText' || type === 'insertFromPaste'
                || type === 'insertReplacementText' || type === 'insertFromDrop') {
                if (!e.data) return;
                e.preventDefault();
                handledByBeforeInput = true;
                if (isActive()) feedText(e.data);
                armBuffer();
            }
        });

        input.addEventListener('input', function () {
            var alreadyHandled = handledByBeforeInput;
            handledByBeforeInput = false;
            // iOS: keydown already drove the race; just drop leftover IME text.
            if (!android) {
                clearBuffer();
                return;
            }
            if (alreadyHandled || !isActive()) {
                armBuffer();
                return;
            }
            var val = input.value || '';
            // Sentinel deleted → backspace (path when keydown is missing).
            if (val === '' || val.length < SENTINEL.length) {
                emitBackspace();
                armBuffer();
                return;
            }
            var typed = val.split(SENTINEL).join('');
            if (typed) feedText(typed);
            armBuffer();
        });

        input.addEventListener('blur', clearBuffer);

        function destroy() {
            stopWatching();
            area.removeEventListener('pointerdown', onTap);
            area.removeEventListener('click', onTap);
            if (input.parentNode) input.parentNode.removeChild(input);
        }

        if (options.signal) {
            if (options.signal.aborted) {
                destroy();
                return NOOP;
            }
            options.signal.addEventListener('abort', destroy, { once: true });
        }

        var controller = { enabled: true, focus: focus, blur: blur, destroy: destroy };
        input.__usertypoSoftKeyboard = controller;
        return controller;
    }

    global.usertypoMobileTyping = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
