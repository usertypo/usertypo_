/**
 * Boot / welcome typing screen — same caret + colors as the home typing test.
 * 60 WPM, smooth caret, lowercase phrases only.
 *
 * Public:
 *   usertypoAwaitBootTyping()           — initial splash promise
 *   usertypoPlayBootTyping(text, mount) — play a phrase into a mount element
 *   usertypoSetAuthWelcome(kind)        — 'new' | 'back' before navigating home
 *   usertypoTakeAuthWelcomePhrase()     — consume pending welcome phrase (once)
 */
(function () {
    var WPM = 60;
    var CHAR_MS = Math.round(60000 / (WPM * 5)); // 200ms at 60 WPM
    var BREATH_MS = 900;
    var AUTH_WELCOME_KEY = 'usertypo_auth_welcome';

    var PHRASES = {
        loading: 'loading',
        new: 'welcome to usertypo',
        back: 'welcome back!'
    };

    var resolveReady;
    var readyPromise = new Promise(function (resolve) {
        resolveReady = resolve;
    });
    var initialFinished = false;
    var playChain = Promise.resolve();

    function markInitialReady() {
        if (initialFinished) return;
        initialFinished = true;
        resolveReady();
    }

    window.usertypoAwaitBootTyping = function () {
        return readyPromise;
    };

    window.usertypoSetAuthWelcome = function (kind) {
        try {
            if (kind === 'new' || kind === 'back') {
                sessionStorage.setItem(AUTH_WELCOME_KEY, kind);
            }
        } catch (e) { /* ignore */ }
    };

    window.usertypoTakeAuthWelcomePhrase = function () {
        var kind = null;
        try {
            kind = sessionStorage.getItem(AUTH_WELCOME_KEY);
            sessionStorage.removeItem(AUTH_WELCOME_KEY);
        } catch (e) { /* ignore */ }
        if (kind === 'new') return PHRASES.new;
        if (kind === 'back') return PHRASES.back;
        return null;
    };

    function peekAuthWelcomeKind() {
        try {
            return sessionStorage.getItem(AUTH_WELCOME_KEY);
        } catch (e) {
            return null;
        }
    }

    function getCaretStyle() {
        return (document.body && document.body.getAttribute('data-caret-style')) || 'underscore';
    }

    function setBootChrome(active) {
        if (!document.body) return;
        if (active) document.body.setAttribute('data-boot-typing', '1');
        else document.body.removeAttribute('data-boot-typing');
        if (active && typeof window.usertypoRevealLogos === 'function') {
            window.usertypoRevealLogos(document);
        }
        document.querySelectorAll('.header-logo-container').forEach(function (logo) {
            logo.classList.add('logo-assets-ready');
        });
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

    function buildMarkup(phrase) {
        var text = String(phrase || PHRASES.loading).toLowerCase();
        var charsHtml = '';
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            var display = ch === ' ' ? '&nbsp;' : ch.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var spaceClass = ch === ' ' ? ' boot-char-space' : '';
            charsHtml +=
                '<span class="char text-slate-500 transition-all duration-150' + spaceClass +
                '" data-boot-char="' + i + '">' + display + '</span>';
        }
        return (
            '<div id="spa-boot-typing" class="flex-1 flex items-center justify-center select-none" aria-live="polite" aria-label="' +
            text.replace(/"/g, '&quot;') + '">' +
            '<div class="font-mono text-[24px] md:text-[30px] leading-[1.5] relative">' +
            '<div id="spa-boot-text" class="relative inline-block whitespace-pre">' +
            '<span id="spa-boot-caret" class="text-primary drop-shadow-[0_0_8px_rgba(0,208,255,0.8)]" aria-hidden="true"></span>' +
            '<div class="word inline-block whitespace-pre">' + charsHtml + '</div>' +
            '</div></div></div>'
        );
    }

    function runTypingAnimation(root) {
        return new Promise(function (resolve) {
            var container = root.querySelector('#spa-boot-text') || document.getElementById('spa-boot-text');
            var caret = root.querySelector('#spa-boot-caret') || document.getElementById('spa-boot-caret');
            if (!container || !caret) {
                resolve();
                return;
            }

            var chars = Array.prototype.slice.call(container.querySelectorAll('.char'));
            if (!chars.length) {
                resolve();
                return;
            }

            caret.classList.remove('animate-breath');
            positionCaret(caret, container, chars, 0, false, true);

            var i = 0;

            function finish() {
                positionCaret(caret, container, chars, chars.length - 1, true, false);
                caret.classList.add('animate-breath');
                setTimeout(resolve, BREATH_MS);
            }

            function step() {
                if (!document.body || !document.body.contains(caret)) {
                    resolve();
                    return;
                }
                if (i >= chars.length) {
                    finish();
                    return;
                }
                paintTyped(chars[i]);
                i += 1;
                if (i < chars.length) {
                    positionCaret(caret, container, chars, i, false, false);
                    setTimeout(step, CHAR_MS);
                } else {
                    finish();
                }
            }

            setTimeout(step, CHAR_MS);
        });
    }

    /**
     * Play a typing phrase into mount (defaults to #spa-page-root).
     * Replaces mount contents with the typing UI until finished.
     */
    window.usertypoPlayBootTyping = function (phrase, mount) {
        var text = String(phrase || PHRASES.loading).toLowerCase();
        playChain = playChain.then(function () {
            return new Promise(function (resolve) {
                var target = mount || document.getElementById('spa-page-root');
                if (!target) {
                    resolve();
                    return;
                }
                setBootChrome(true);
                target.innerHTML = buildMarkup(text);
                var root = target.querySelector('#spa-boot-typing') || target;

                var fontsReady = (document.fonts && document.fonts.ready)
                    ? document.fonts.ready.catch(function () {})
                    : Promise.resolve();

                fontsReady.then(function () {
                    return runTypingAnimation(root);
                }).then(function () {
                    setBootChrome(false);
                    resolve();
                }).catch(function () {
                    setBootChrome(false);
                    resolve();
                });
            });
        });
        return playChain;
    };

    function resolveInitialPhrase() {
        var kind = peekAuthWelcomeKind();
        if (kind === 'new' || kind === 'back') {
            return window.usertypoTakeAuthWelcomePhrase() || PHRASES.loading;
        }
        return PHRASES.loading;
    }

    function hydrateExistingBoot(phrase) {
        var root = document.getElementById('spa-boot-typing');
        var container = document.getElementById('spa-boot-text');
        if (!root || !container) return false;
        var word = container.querySelector('.word');
        var caret = document.getElementById('spa-boot-caret');
        if (!word || !caret) return false;

        var text = String(phrase || PHRASES.loading).toLowerCase();
        root.setAttribute('aria-label', text);
        word.innerHTML = '';
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            var span = document.createElement('span');
            span.className = 'char text-slate-500 transition-all duration-150' + (ch === ' ' ? ' boot-char-space' : '');
            span.setAttribute('data-boot-char', String(i));
            span.innerHTML = ch === ' ' ? '&nbsp;' : ch;
            word.appendChild(span);
        }
        return true;
    }

    function startInitial() {
        setBootChrome(true);
        var phrase = resolveInitialPhrase();

        if (!hydrateExistingBoot(phrase)) {
            var mount = document.getElementById('spa-page-root');
            if (mount) mount.innerHTML = buildMarkup(phrase);
        }

        var root = document.getElementById('spa-boot-typing') || document.getElementById('spa-page-root');
        var fontsReady = (document.fonts && document.fonts.ready)
            ? document.fonts.ready.catch(function () {})
            : Promise.resolve();

        fontsReady.then(function () {
            return runTypingAnimation(root || document);
        }).then(function () {
            setBootChrome(false);
            markInitialReady();
        }).catch(function () {
            setBootChrome(false);
            markInitialReady();
        });
    }

    if (document.getElementById('spa-boot-typing') || document.getElementById('spa-page-root')) {
        startInitial();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startInitial);
    } else {
        startInitial();
    }
})();
