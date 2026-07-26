/**
 * Boot loading screen — types "Loading" like the home typing test at 50 WPM.
 * Caret style follows settings via #spa-boot-caret (styled by buildCaretCSS).
 */
(function () {
    var WPM = 50;
    // Standard WPM: 5 chars/word → ms between keystrokes
    var CHAR_MS = Math.round(60000 / (WPM * 5)); // 240ms at 50 WPM

    var resolveReady;
    var readyPromise = new Promise(function (resolve) {
        resolveReady = resolve;
    });
    var finished = false;
    var started = false;

    function markReady() {
        if (finished) return;
        finished = true;
        resolveReady();
    }

    window.usertypoAwaitBootTyping = function () {
        return readyPromise;
    };

    function getCaretStyle() {
        return (document.body && document.body.getAttribute('data-caret-style')) || 'underscore';
    }

    function positionCaret(caret, container, chars, index, isAfter, instant) {
        if (!caret || !container || !chars.length) return;
        var charIndex = Math.min(Math.max(index, 0), chars.length - 1);
        var target = chars[charIndex];
        if (!target) return;

        var rect = target.getBoundingClientRect();
        var containerRect = container.getBoundingClientRect();
        var left = rect.left - containerRect.left;
        var top = rect.top - containerRect.top;
        if (isAfter) left += rect.width;

        if (instant) {
            caret.style.transition = 'none';
        }

        caret.style.transform = 'translate3d(' + left + 'px, ' + top + 'px, 0)';
        if (getCaretStyle() === 'line') {
            caret.style.width = '2.5px';
        } else {
            caret.style.width = rect.width + 'px';
        }

        if (instant) {
            void caret.offsetWidth;
            caret.style.removeProperty('transition');
        }
    }

    function paintTyped(charEl) {
        charEl.className = 'char transition-all duration-150 text-primary drop-shadow-[0_0_5px_rgba(0,208,255,0.4)]';
    }

    function run() {
        if (started) return;
        var root = document.getElementById('spa-boot-typing');
        var container = document.getElementById('spa-boot-text');
        var caret = document.getElementById('spa-boot-caret');
        if (!root || !container || !caret) {
            markReady();
            return;
        }
        started = true;

        var chars = Array.prototype.slice.call(container.querySelectorAll('.char'));
        if (!chars.length) {
            markReady();
            return;
        }

        caret.classList.remove('animate-breath');
        positionCaret(caret, container, chars, 0, false, true);

        var i = 0;

        function step() {
            if (!document.getElementById('spa-boot-typing')) {
                markReady();
                return;
            }

            if (i < chars.length) {
                paintTyped(chars[i]);
                i += 1;
                if (i < chars.length) {
                    positionCaret(caret, container, chars, i, false, false);
                    setTimeout(step, CHAR_MS);
                } else {
                    positionCaret(caret, container, chars, chars.length - 1, true, false);
                    caret.classList.add('animate-breath');
                    // Let the caret breathe briefly before the SPA swaps the page in
                    setTimeout(markReady, 900);
                }
                return;
            }

            markReady();
        }

        // Brief beat with caret under L before the first keystroke (matches test feel)
        setTimeout(step, CHAR_MS);
    }

    // Script is placed directly under the boot markup, so nodes already exist.
    if (document.getElementById('spa-boot-typing')) {
        run();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }

    // Reposition if fonts/settings land after first paint
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
            var container = document.getElementById('spa-boot-text');
            var caret = document.getElementById('spa-boot-caret');
            if (!container || !caret || finished) return;
            var chars = Array.prototype.slice.call(container.querySelectorAll('.char'));
            var typed = container.querySelectorAll('.char.text-primary').length;
            var index = Math.min(typed, Math.max(chars.length - 1, 0));
            var isAfter = typed >= chars.length && chars.length > 0;
            positionCaret(caret, container, chars, isAfter ? chars.length - 1 : index, isAfter, true);
        });
    }
})();
