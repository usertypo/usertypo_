/**
 * Boot / welcome typing — fixed centered overlay, 70 WPM.
 * Caret moves smoothly on X only (no width morph / vertical slide).
 *
 * Public:
 *   usertypoAwaitBootTyping()
 *   usertypoPlayBootTyping(text)
 *   usertypoSetAuthWelcome(kind)        — 'new' | 'back'
 *   usertypoTakeAuthWelcomePhrase()
 */
(function () {
    var WPM = 70;
    var CHAR_MS = Math.round(60000 / (WPM * 5)); // ~171ms
    var MOVE_MS = Math.min(140, Math.max(80, CHAR_MS - 30));
    var BREATH_MS = 700;
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
    var playLock = Promise.resolve();

    function markInitialReady() {
        if (initialFinished) return;
        initialFinished = true;
        try { resolveReady(); } catch (e) { /* ignore */ }
    }

    window.usertypoAwaitBootTyping = function () {
        return readyPromise;
    };

    window.usertypoSetAuthWelcome = function (kind) {
        if (kind !== 'new' && kind !== 'back') return;
        try { sessionStorage.setItem(AUTH_WELCOME_KEY, kind); } catch (e) { /* ignore */ }
        window.__usertypoPendingWelcome = kind;
    };

    window.usertypoTakeAuthWelcomePhrase = function () {
        var kind = null;
        try {
            kind = sessionStorage.getItem(AUTH_WELCOME_KEY);
            sessionStorage.removeItem(AUTH_WELCOME_KEY);
        } catch (e) { /* ignore */ }
        if (!kind && window.__usertypoPendingWelcome) {
            kind = window.__usertypoPendingWelcome;
        }
        window.__usertypoPendingWelcome = null;
        if (kind === 'new') return PHRASES.new;
        if (kind === 'back') return PHRASES.back;
        return null;
    };

    function peekWelcomeKind() {
        if (window.__usertypoPendingWelcome === 'new' || window.__usertypoPendingWelcome === 'back') {
            return window.__usertypoPendingWelcome;
        }
        try {
            var k = sessionStorage.getItem(AUTH_WELCOME_KEY);
            if (k === 'new' || k === 'back') return k;
        } catch (e) { /* ignore */ }
        return null;
    }

    function getCaretStyle() {
        return (document.body && document.body.getAttribute('data-caret-style')) || 'underscore';
    }

    function setBootChrome(active) {
        if (!document.body) return;
        if (active) document.body.setAttribute('data-boot-typing', '1');
        else document.body.removeAttribute('data-boot-typing');
        if (typeof window.usertypoRevealLogos === 'function') {
            window.usertypoRevealLogos(document);
        }
        document.querySelectorAll('.header-logo-container').forEach(function (logo) {
            logo.classList.add('logo-assets-ready');
        });
    }

    function ensureOverlay() {
        var overlay = document.getElementById('spa-boot-overlay');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'spa-boot-overlay';
        overlay.setAttribute('aria-hidden', 'false');
        document.body.appendChild(overlay);
        return overlay;
    }

    function buildInner(phrase) {
        var text = String(phrase || PHRASES.loading).toLowerCase();
        var charsHtml = '';
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            var display = ch === ' ' ? '&nbsp;' : ch.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            charsHtml +=
                '<span class="char text-slate-500' + (ch === ' ' ? ' boot-char-space' : '') +
                '" data-boot-char="' + i + '">' + display + '</span>';
        }
        return (
            '<div id="spa-boot-typing" class="spa-boot-typing-inner" aria-live="polite" aria-label="' +
            text.replace(/"/g, '&quot;') + '">' +
            '<div class="spa-boot-line font-mono">' +
            '<div id="spa-boot-text" class="spa-boot-text">' +
            '<span id="spa-boot-caret" class="text-primary" aria-hidden="true"></span>' +
            '<div class="word">' + charsHtml + '</div>' +
            '</div></div></div>'
        );
    }

    function positionCaret(caret, container, chars, index, isAfter, instant) {
        if (!caret || !container || !chars.length) return;
        var charIndex = Math.min(Math.max(index, 0), chars.length - 1);
        var target = chars[charIndex];
        if (!target) return;

        var left = target.offsetLeft;
        if (isAfter) left += target.offsetWidth;

        // Width updates instantly — only X translate is eased (no stretchy slide)
        if (getCaretStyle() === 'line') {
            caret.style.width = '2.5px';
        } else {
            caret.style.width = target.offsetWidth + 'px';
        }

        if (instant) {
            caret.style.transition = 'none';
            caret.style.transform = 'translate3d(' + left + 'px, 0, 0)';
            void caret.offsetWidth;
            caret.style.transition = 'transform ' + MOVE_MS + 'ms cubic-bezier(0.2, 0, 0.2, 1)';
        } else {
            caret.style.transition = 'transform ' + MOVE_MS + 'ms cubic-bezier(0.2, 0, 0.2, 1)';
            caret.style.transform = 'translate3d(' + left + 'px, 0, 0)';
        }
    }

    function paintTyped(charEl) {
        charEl.classList.remove('text-slate-500');
        charEl.classList.add('text-primary', 'is-typed');
    }

    function runTypingAnimation(overlay) {
        return new Promise(function (resolve) {
            var container = overlay.querySelector('#spa-boot-text');
            var caret = overlay.querySelector('#spa-boot-caret');
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
            // Double rAF so layout is settled before first place
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    positionCaret(caret, container, chars, 0, false, true);

                    var i = 0;

                    function finish() {
                        positionCaret(caret, container, chars, chars.length - 1, true, false);
                        caret.classList.add('animate-breath');
                        setTimeout(resolve, BREATH_MS);
                    }

                    function step() {
                        if (!document.body.contains(caret)) {
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
            });
        });
    }

    function showOverlay(phrase) {
        var overlay = ensureOverlay();
        overlay.hidden = false;
        overlay.innerHTML = buildInner(phrase);
        overlay.classList.add('is-visible');
        setBootChrome(true);
        return overlay;
    }

    function hideOverlay() {
        var overlay = document.getElementById('spa-boot-overlay');
        if (overlay) {
            overlay.classList.remove('is-visible');
            overlay.hidden = true;
            overlay.innerHTML = '';
        }
        setBootChrome(false);
    }

    window.usertypoPlayBootTyping = function (phrase) {
        var text = String(phrase || PHRASES.loading).toLowerCase();
        playLock = playLock.then(function () {
            var overlay = showOverlay(text);
            return runTypingAnimation(overlay).then(function () {
                hideOverlay();
            }).catch(function () {
                hideOverlay();
            });
        });
        return playLock;
    };

    function startInitial() {
        var kind = peekWelcomeKind();
        var phrase = PHRASES.loading;
        if (kind === 'new' || kind === 'back') {
            phrase = window.usertypoTakeAuthWelcomePhrase() || PHRASES.loading;
        }

        // Prefer existing overlay markup in the document if present
        var overlay = document.getElementById('spa-boot-overlay');
        if (!overlay) {
            overlay = showOverlay(phrase);
        } else {
            overlay.hidden = false;
            overlay.classList.add('is-visible');
            overlay.innerHTML = buildInner(phrase);
            setBootChrome(true);
        }

        // Clear any leftover placeholder inside spa-page-root
        var pageRoot = document.getElementById('spa-page-root');
        if (pageRoot) {
            var legacy = pageRoot.querySelector('#spa-boot-typing');
            if (legacy) legacy.remove();
        }

        runTypingAnimation(overlay).then(function () {
            hideOverlay();
            markInitialReady();
        }).catch(function () {
            hideOverlay();
            markInitialReady();
        });
    }

    if (document.body) {
        startInitial();
    } else {
        document.addEventListener('DOMContentLoaded', startInitial);
    }
})();
