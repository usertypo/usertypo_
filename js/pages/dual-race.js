/**
 * Multiplayer dual page controller.
 * The server owns room lifecycle/timing; this module owns local typing visuals only.
 */
(function () {
    'use strict';

    var refreshHandledKey = 'usertypo:dual-refresh-handled-room';
    var dualMemberKey = 'usertypo:dual-member-room';

    function createController() {
        var abort = new AbortController();
        var signal = abort.signal;
        var params = new URLSearchParams(window.location.search);
        var isLocalBot = params.get('local') === 'bot';
        var roomId = isLocalBot ? 'local-bot' : (params.get('room') || '');
        var state = 'joining';
        var config = null;
        var words = [];
        var wordOffsets = [];
        var players = [];
        var bot = null;
        var matchReason = '';
        var selfUserId = '';
        var selfIndex = -1;
        var opponentIndex = -1;
        var startTime = 0;
        var currentWordIndex = 0;
        var currentCharIndex = 0;
        var completedCorrectWords = 0;
        var packetSequence = 0;
        var packetQueue = [];
        var packetSending = false;
        var totalKeystrokes = 0;
        var errorsMade = 0;
        var extraChars = 0;
        var keystrokeTimes = [];
        var correctKeystrokeTimes = [];
        var unresolvedError = null;
        var errorHistory = [];
        var opponentLeft = false;
        var updateTimer = null;
        var liveRawSecondKeystrokes = 0;
        var lastLiveRawSecond = 0;
        var rawHistory = [];
        var wpmHistory = [];
        var lastRawHistorySecond = 0;
        var lastSecondKeystrokes = 0;
        var oppWpmHistory = [];
        var oppRawHistory = [];
        var oppLastHistorySecond = 0;
        var oppLatestOffset = 0;
        var oppOffsetAtSecondStart = 0;
        var graphSeriesBySide = { w: null, l: null };
        var graphSelectedSide = 'w';
        var graphAnimationPlayed = false;
        var graphPillBound = false;
        var graphResizeBound = false;
        var localFinished = false;
        var latestResults = null;
        var lineHeight = 0;
        var CURSOR_SYNC_INTERVAL_MS = 150;
        var OPPONENT_LERP_MS = 150;
        var OPPONENT_CURSOR_STALE_MS = 600;

        var opponentOffset = 0;
        var opponentTargetOffset = 0;
        var opponentDisplayOffset = 0;
        var opponentDisplayWordIndex = 0;
        var opponentDisplayCharIndex = 0;
        var opponentDisplayWpm = 0;
        var opponentTargetWpm = 0;
        var opponentTargetWordIndex = 0;
        var opponentTargetCharIndex = 0;
        var opponentHasReport = false;
        var opponentFrameAt = 0;
        var opponentAnimationFrame = null;
        var cursorSyncTimer = null;
        var localBotTimer = null;
        var lastOpponentCursorAt = 0;
        var lastCursorSentAt = 0;
        var lastSentCursorKey = '';
        var localFinishTime = 0;
        var statsHeaderReady = false;
        var rematchVotes = 0;
        var rematchNeeded = 2;
        var selfRematchVoted = false;
        var raceKeysBound = false;
        var raceStartToken = 0;
        var pendingRacePayload = null;
        var countdownAnimToken = 0;
        var introBusy = false;
        var countdownSequenceStarted = false;
        var countdownTapeLocked = false;
        var countdownTapeTransform = '';
        var countdownTapeBaseX = 0;
        var countdownEndsAtTarget = 0;
        var closingDual = false;

        var testView = document.getElementById('test-view');
        var statsView = document.getElementById('stats-view');
        var typingArea = document.getElementById('typing-area');
        var textContainer = document.getElementById('text-container');
        var caret = document.getElementById('caret');
        var opponentCaret = document.getElementById('bot-caret');
        var wpmDisplay = document.getElementById('wpm-display');
        var rawWpmDisplay = document.getElementById('raw-wpm-display');
        var accDisplay = document.getElementById('acc-display');
        var burstDisplay = document.getElementById('burst-display');
        var opponentWpmDisplay = document.getElementById('bot-wpm-display');
        var progressDisplay = document.getElementById('word-progress');
        var progressBar = document.getElementById('word-progress-bar');
        var opponentAvatar = document.getElementById('bot-avatar');
        var waitOverlay = null;
        var zenHandlersBound = false;
        var zenTypingActive = false;

        // --- Footer / header helpers ---
        var testViewFooter = document.getElementById('test-view-footer');
        var shellFooter = document.getElementById('spa-shell-footer');
        var footerNavLinks = testViewFooter ? testViewFooter.querySelector('.footer-nav-links') : null;
        var shellFooterNavLinks = shellFooter ? shellFooter.querySelector('.footer-nav-links') : null;

        function clearReactKeyHighlights(keys) {
            keys.forEach(function (key) {
                key.classList.remove('bg-primary/40', 'scale-[0.92]', 'drop-shadow-[0_0_8px_rgba(0,208,255,0.4)]');
                if (!key.classList.contains('bg-primary/10')) {
                    key.classList.add('bg-primary/10');
                }
            });
        }

        function configFlag(value) {
            return value === true || value === 1 || value === '1';
        }

        function ensureDualKeymapHook() {
            window.usertypo_getKeymapRenderArgs = function () {
                if (!config) {
                    return { useNumbers: false, usePunctuation: false };
                }
                return {
                    useNumbers: configFlag(config.nums),
                    usePunctuation: configFlag(config.punct),
                };
            };
        }

        function seedConfigFromPendingMatch() {
            if (config) return;
            var pending = window.DualMatch && typeof window.DualMatch.loadRequest === 'function'
                ? window.DualMatch.loadRequest()
                : null;
            if (!pending || String(pending.roomId || '') !== roomId || !pending.config) return;
            config = pending.config;
        }

        function applyDualRaceConfig(nextConfig) {
            if (!nextConfig) return;
            config = nextConfig;
        }

        function applyDualTestSettings() {
            if (window.usertypo_settingsApi) {
                try {
                    window.usertypo_settingsApi.applyAllSettings(window.usertypo_settingsApi.loadSettings());
                } catch (_) { /* retain current settings */ }
            }
            bindDualKeymapRenderArgs();
        }

        function setDualFooterMode(mode) {
            if (mode === 'stats-full') {
                if (testViewFooter) testViewFooter.style.display = 'none';
                if (shellFooter) {
                    shellFooter.classList.remove('hidden');
                    if (shellFooterNavLinks) shellFooterNavLinks.style.display = '';
                }
            } else {
                if (shellFooter) shellFooter.classList.add('hidden');
                if (testViewFooter) {
                    testViewFooter.style.display = '';
                    if (footerNavLinks) footerNavLinks.style.display = 'none';
                    testViewFooter.classList.add('justify-end');
                    testViewFooter.classList.remove('justify-between');
                }
            }
        }

        function setFooterCompact(compact) {
            if (compact) {
                setDualFooterMode('test-compact');
                return;
            }
            if (footerNavLinks) footerNavLinks.style.display = '';
            if (testViewFooter) {
                testViewFooter.classList.toggle('justify-end', false);
                testViewFooter.classList.toggle('justify-between', true);
            }
        }

        function setDualHeaderInteractive(enabled) {
            var headerLeft = document.getElementById('header-left');
            var headerRight = document.getElementById('header-right');
            var headerLogo = document.getElementById('header-logo-link');
            var menuWrapper = document.getElementById('expanding-menu-wrapper');
            var header = document.querySelector('body > header');
            if (enabled) {
                if (headerLeft) {
                    headerLeft.classList.remove('opacity-0', 'pointer-events-none', 'zen-hidden');
                    headerLeft.style.overflow = 'visible';
                }
                if (headerRight) {
                    headerRight.classList.remove('opacity-0', 'pointer-events-none', 'zen-hidden');
                }
                if (headerLogo) headerLogo.style.pointerEvents = '';
                if (menuWrapper) menuWrapper.style.overflow = 'visible';
                if (header) header.style.overflow = 'visible';
                if (typeof window.usertypoRemeasureExpandingBubble === 'function') {
                    window.usertypoRemeasureExpandingBubble();
                }
            } else {
                if (headerLeft) headerLeft.classList.add('opacity-0', 'pointer-events-none');
                if (headerRight) headerRight.classList.add('opacity-0', 'pointer-events-none');
                if (headerLogo) headerLogo.style.pointerEvents = 'none';
                if (typeof window.usertypoCloseExpandingBubble === 'function') {
                    window.usertypoCloseExpandingBubble();
                }
            }
        }

        function syncDualTypingScroll() {
            var kl = window.usertypo_settings && window.usertypo_settings.keyboardLayout;
            var keymapOn = !!(kl && kl.keymapMode && kl.keymapMode !== 'Off');
            var body = document.getElementById('app-body');
            var content = document.getElementById('spa-content');
            var pageRoot = document.getElementById('spa-page-root');
            var appViews = document.getElementById('app-views');
            var testMain = document.getElementById('dual-test-main');
            if (keymapOn) {
                if (typeof window.usertypo_unlockStatsScroll === 'function') {
                    window.usertypo_unlockStatsScroll();
                }
                if (body) {
                    body.classList.remove('h-screen', 'overflow-hidden');
                    body.classList.add('min-h-screen', 'overflow-y-auto', 'overflow-x-hidden', 'keymap-scrollable');
                }
                if (content) content.classList.remove('min-h-0', 'overflow-hidden');
                if (pageRoot) pageRoot.classList.remove('min-h-0', 'overflow-hidden');
                if (appViews) appViews.classList.remove('h-full', 'min-h-0', 'overflow-hidden');
                if (testMain) testMain.classList.remove('min-h-0');
            } else {
                if (body) body.classList.remove('keymap-scrollable');
                if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.syncTypingScrollForKeymap === 'function') {
                    window.usertypo_settingsApi.syncTypingScrollForKeymap(false);
                } else if (typeof window.usertypo_lockTypingScroll === 'function') {
                    window.usertypo_lockTypingScroll();
                }
                if (appViews) appViews.classList.add('h-full', 'min-h-0');
            }
            if (keymapOn && window.usertypo_settingsApi
                && typeof window.usertypo_settingsApi.syncTypingScrollForKeymap === 'function') {
                window.usertypo_settingsApi.syncTypingScrollForKeymap(true);
            }
        }

        function measureDualScrollPad() {
            var pad = document.getElementById('dual-scroll-pad');
            if (!pad) return 0;
            var kl = window.usertypo_settings && window.usertypo_settings.keyboardLayout;
            var keymapOn = !!(kl && kl.keymapMode && kl.keymapMode !== 'Off');
            if (!keymapOn) {
                pad.style.height = '0';
                return 0;
            }
            var keymap = document.getElementById('dynamic-keymap-container');
            if (!keymap || keymap.classList.contains('hidden')) {
                pad.style.height = '0';
                return 0;
            }
            var footer = document.getElementById('test-view-footer');
            var padHeight = 0;
            if (footer && keymap) {
                var overlap = keymap.getBoundingClientRect().bottom - footer.getBoundingClientRect().top + 16;
                if (overlap > 0) padHeight = Math.max(padHeight, overlap);
            }
            pad.style.height = Math.ceil(padHeight) + 'px';
            return padHeight;
        }

        function afterDualLineLayout() {
            requestAnimationFrame(function () {
                syncDualKeymapLayout();
            });
        }

        function syncDualKeymapLayout() {
            syncDualTypingScroll();
            var kl = window.usertypo_settings && window.usertypo_settings.keyboardLayout;
            var keymapOn = !!(kl && kl.keymapMode && kl.keymapMode !== 'Off');
            if (!keymapOn) {
                measureDualScrollPad();
                return;
            }
            setTimeout(function () {
                measureDualScrollPad();
            }, 50);
        }

        function bindDualKeymapRenderArgs() {
            ensureDualKeymapHook();
            if (!config) return;
            if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.applyKeymapDisplay === 'function') {
                try {
                    window.usertypo_settingsApi.applyKeymapDisplay(window.usertypo_settingsApi.loadSettings());
                } catch (_) { /* retain current keymap */ }
            }
            syncDualKeymapLayout();
        }

        function hideZenElements() {
            document.querySelectorAll('#test-view .zen-element').forEach(function (el) {
                el.classList.add('zen-hidden');
            });
        }

        function showZenElements() {
            document.querySelectorAll('#test-view .zen-element').forEach(function (el) {
                el.classList.remove('zen-hidden');
            });
        }

        function resetZenState() {
            zenTypingActive = false;
            showZenElements();
        }

        function wireZenHandlers() {
            if (zenHandlersBound) return;
            zenHandlersBound = true;
            document.addEventListener('mousemove', function () {
                if (state !== 'racing' || !zenTypingActive) return;
                showZenElements();
            }, { signal: signal });
        }

        function stopZenMode() {
            resetZenState();
        }

        function listen(name, handler) {
            window.addEventListener('usertypo:multiplayer:' + name, handler, { signal: signal });
        }

        function updateKeymapHighlight(pressedKey, isKeyDown) {
            var keyboard = window.usertypo_settings?.keyboardLayout || {};
            if (!keyboard.keymapMode || keyboard.keymapMode === 'Off') return;
            var keys = document.querySelectorAll('#test-view .keymap-key');
            if (keyboard.keymapLegend === 'Dynamic') {
                var expected = words[currentWordIndex]?.[currentCharIndex] || '';
                var uppercase = keyboard.keymapMode === 'Next'
                    ? /[A-Z\u0400-\u04FF\u0370-\u03FF]/.test(expected)
                    : (pressedKey === 'Shift' && isKeyDown);
                keys.forEach(function (key) {
                    var text = key.querySelector('.keymap-main-text');
                    if (text && text.textContent.length >= 1) {
                        text.textContent = uppercase ? text.textContent.toUpperCase() : text.textContent.toLowerCase();
                    }
                    var qwerty = key.querySelector('.keymap-qwerty-text');
                    if (qwerty && qwerty.textContent.length === 1) {
                        qwerty.textContent = uppercase ? qwerty.textContent.toUpperCase() : qwerty.textContent.toLowerCase();
                    }
                });
            }
            if (keyboard.keymapMode === 'Static') return;
            if (keyboard.keymapMode === 'React') {
                if (!pressedKey) return;
                if (isKeyDown) {
                    clearReactKeyHighlights(keys);
                }
                keys.forEach(function (key) {
                    var chars = key.dataset.chars || '';
                    var special = key.dataset.special || '';
                    var matches = false;
                    if (pressedKey.length === 1 && chars.includes(pressedKey)) matches = true;
                    if (pressedKey === ' ' && special === 'Space') matches = true;
                    if (pressedKey === 'Backspace' && special === 'Backspace') matches = true;
                    if (pressedKey === 'Tab' && special === 'Tab') matches = true;
                    if (pressedKey === 'Enter' && special === 'Enter') matches = true;
                    if (pressedKey === 'Shift' && special === 'Shift') matches = true;
                    if (pressedKey === 'CapsLock' && special === 'Caps') matches = true;
                    if (matches) {
                        if (isKeyDown) {
                            key.classList.add('bg-primary/40', 'scale-[0.92]', 'drop-shadow-[0_0_8px_rgba(0,208,255,0.4)]');
                            key.classList.remove('bg-primary/10');
                        } else {
                            key.classList.remove('bg-primary/40', 'scale-[0.92]', 'drop-shadow-[0_0_8px_rgba(0,208,255,0.4)]');
                            key.classList.add('bg-primary/10');
                        }
                    }
                });
                return;
            }
            if (keyboard.keymapMode === 'Next') {
                var next = words[currentWordIndex]?.[currentCharIndex] || ' ';
                keys.forEach(function (key) {
                    var chars = key.dataset.chars || '';
                    var special = key.dataset.special || '';
                    if (chars.includes(next) || (next === ' ' && special === 'Space')) {
                        key.classList.add('bg-primary/40', 'scale-95', 'ring-2', 'ring-primary/50');
                        key.classList.remove('bg-primary/10');
                    } else {
                        key.classList.remove('bg-primary/40', 'scale-95', 'ring-2', 'ring-primary/50');
                        key.classList.add('bg-primary/10');
                    }
                });
            }
        }

        function showMessage(message, detail) {
            if (!waitOverlay) {
                waitOverlay = document.createElement('div');
                waitOverlay.id = 'dual-wait-overlay';
                waitOverlay.className = 'absolute inset-0 z-40 flex flex-col items-center justify-center text-center bg-background-dark/95 transition-opacity duration-200';
                testView.appendChild(waitOverlay);
            }
            waitOverlay.innerHTML =
                '<div class="material-symbols-outlined text-primary text-4xl mb-3">swords</div>' +
                '<div class="text-white text-xl font-bold">' + escapeHtml(message) + '</div>' +
                (detail ? '<div class="text-slate-400 text-sm mt-2">' + escapeHtml(detail) + '</div>' : '');
            waitOverlay.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
            if (typingArea) typingArea.style.visibility = 'hidden';
        }

        function hideMessage() {
            if (waitOverlay) waitOverlay.classList.add('opacity-0', 'pointer-events-none');
            if (typingArea) typingArea.style.visibility = '';
            setTimeout(function () {
                if (waitOverlay) waitOverlay.classList.add('hidden');
            }, 220);
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function getSessionFlag(key) {
            try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; }
        }

        function setSessionFlag(key, value) {
            try {
                if (value == null || value === '') sessionStorage.removeItem(key);
                else sessionStorage.setItem(key, value);
            } catch (_) { /* ignore */ }
        }

        function markDualMembership(active) {
            setSessionFlag(dualMemberKey, active ? roomId : '');
        }

        function isReloadNavigation() {
            try {
                var entries = performance.getEntriesByType('navigation');
                // Use the real document boot path from the router — not the path when this
                // lazy script first evaluated (always /dual) — so SPA joins after a refresh
                // elsewhere are not treated as dual-page reloads.
                var bootPath = window.__usertypoBootPath || '';
                var handledRoom = getSessionFlag(refreshHandledKey);
                var memberRoom = getSessionFlag(dualMemberKey);
                return bootPath === '/dual'
                    && entries.length
                    && entries[0].type === 'reload'
                    && memberRoom === roomId
                    && handledRoom !== roomId;
            } catch (_) {
                return false;
            }
        }

        function redirectAfterRefresh() {
            setSessionFlag(refreshHandledKey, roomId);
            markDualMembership(false);
            if (roomId && window.usertypoMultiplayer) {
                try { window.usertypoMultiplayer.leaveRace(roomId); } catch (_) { /* ignore */ }
            }
            if (window.usertypoNotifications) {
                window.usertypoNotifications.showToast('You left the dual because the page was refreshed.', 'cancel');
            }
            if (typeof window.navigateTo === 'function') window.navigateTo('/multiplayer');
            else window.location.replace('/multiplayer');
        }

        function appendWord(word, wordIndex) {
            var wordElement = document.createElement('div');
            wordElement.id = 'word-' + wordIndex;
            wordElement.className = 'word';
            word.split('').forEach(function (character, charIndex) {
                var characterElement = document.createElement('span');
                characterElement.id = 'char-' + wordIndex + '-' + charIndex;
                characterElement.className = 'char text-slate-500 transition-colors duration-75';
                characterElement.textContent = character;
                wordElement.appendChild(characterElement);
            });
            textContainer.appendChild(wordElement);
        }

        function renderPrompt() {
            if (typeof window.applyTypingTextDirection === 'function') {
                window.applyTypingTextDirection();
            }
            textContainer.querySelectorAll('.word').forEach(function (element) { element.remove(); });
            wordOffsets = [];
            var runningOffset = 0;
            words.forEach(function (word, index) {
                wordOffsets[index] = runningOffset;
                runningOffset += word.length + 1;
            });
            words.forEach(appendWord);
            textContainer.offsetHeight;
            requestAnimationFrame(function () {
                updateLineLayout();
                updateCaret();
            });
        }

        function getTapeMode() {
            return document.body.getAttribute('data-tape-mode')
                || window.usertypo_settings?.cursor?.tapeMode
                || 'off';
        }

        function wordOffset(wordIndex) {
            if (wordOffsets[wordIndex] != null) return wordOffsets[wordIndex];
            var offset = 0;
            for (var i = 0; i < wordIndex && i < words.length; i += 1) offset += words[i].length + 1;
            return offset;
        }

        function offsetToPosition(offset) {
            for (var i = 0; i < words.length; i += 1) {
                var start = wordOffset(i);
                if (offset <= start + words[i].length) {
                    return { wordIndex: i, charIndex: Math.max(0, Math.floor(offset - start)) };
                }
            }
            var last = Math.max(0, words.length - 1);
            return { wordIndex: last, charIndex: words[last] ? words[last].length : 0 };
        }

        function updateLineLayout() {
            var wordElements = Array.from(textContainer.querySelectorAll('.word'));
            if (!wordElements.length) return;
            var tapeMode = getTapeMode();
            if (tapeMode === 'word' || tapeMode === 'letter') {
                wordElements.forEach(function (element) { element.dataset.line = '0'; });
                lineHeight = wordElements[0].offsetHeight + parseFloat(getComputedStyle(textContainer).rowGap || 0);
                if (!lineHeight || lineHeight <= wordElements[0].offsetHeight) {
                    lineHeight = parseFloat(getComputedStyle(wordElements[0]).lineHeight) || 43;
                }
                typingArea.style.height = lineHeight + 'px';
                handleScroll();
                afterDualLineLayout();
                return;
            }

            var currentTop = -1;
            var currentLine = -1;
            wordElements.forEach(function (element) {
                if (currentTop < 0 || Math.abs(element.offsetTop - currentTop) > 10) {
                    currentTop = element.offsetTop;
                    currentLine += 1;
                }
                element.dataset.line = String(currentLine);
            });
            var firstLine = textContainer.querySelector('.word[data-line="0"]');
            var secondLine = textContainer.querySelector('.word[data-line="1"]');
            lineHeight = firstLine && secondLine
                ? secondLine.offsetTop - firstLine.offsetTop
                : (parseFloat(getComputedStyle(wordElements[0]).lineHeight) || 43) * 1.3;
            typingArea.style.height = (lineHeight * Math.min(3, currentLine + 1)) + 'px';
            handleScroll();
            afterDualLineLayout();
        }

        function applyTapeScroll() {
            var currentWord = document.getElementById('word-' + currentWordIndex);
            if (!currentWord || !typingArea.clientWidth) return;
            var center = typingArea.clientWidth / 2;
            var isRtl = typeof window.isTypingRTL === 'function' ? window.isTypingRTL() : false;
            if (getTapeMode() === 'word') {
                var wordCenter = (typeof window.getWordTapeCenterX === 'function')
                    ? window.getWordTapeCenterX(currentWord, textContainer)
                    : (currentWord.offsetLeft + currentWord.offsetWidth / 2);
                textContainer.style.transform = 'translateX(' + Math.round(center - wordCenter) + 'px)';
                return;
            }
            var resolved = (typeof window.resolveCaretCharTarget === 'function')
                ? window.resolveCaretCharTarget(currentWord, currentWordIndex, currentCharIndex, 'char')
                : (function () {
                    var target = document.getElementById('char-' + currentWordIndex + '-' + currentCharIndex);
                    var after = false;
                    if (!target) {
                        target = document.getElementById('char-' + currentWordIndex + '-' + (currentCharIndex - 1));
                        after = true;
                    }
                    return { target: target || currentWord, isAfter: after };
                })();
            var box = (typeof window.getCaretLayoutInContainer === 'function')
                ? window.getCaretLayoutInContainer(textContainer, currentWord, resolved.target, resolved.isAfter, isRtl)
                : { left: resolved.target.offsetLeft + (resolved.isAfter && !isRtl ? resolved.target.offsetWidth : 0) };
            textContainer.style.transform = 'translateX(' + Math.round(center - box.left) + 'px)';
        }

        function handleScroll() {
            var currentWord = document.getElementById('word-' + currentWordIndex);
            if (!currentWord) return;
            var tapeMode = getTapeMode();
            if (tapeMode === 'word' || tapeMode === 'letter') {
                applyTapeScroll();
                return;
            }
            var line = Number.parseInt(currentWord.dataset.line || '0', 10);
            var targetLine = Math.max(0, line - 1);
            var targetWord = textContainer.querySelector('.word[data-line="' + targetLine + '"]');
            var firstWord = textContainer.querySelector('.word[data-line="0"]');
            var offset = targetWord && firstWord
                ? targetWord.offsetTop - firstWord.offsetTop
                : Math.max(0, line - 1) * lineHeight;
            textContainer.style.transform = 'translateY(-' + offset + 'px)';
        }

        function positionCaretAt(element, wordIndex, charIndex) {
            if (!element || !textContainer || !words[wordIndex]) return;
            var wordElement = document.getElementById('word-' + wordIndex);
            if (!wordElement) return;
            var isRtl = typeof window.isTypingRTL === 'function' ? window.isTypingRTL() : false;
            var resolved = (typeof window.resolveCaretCharTarget === 'function')
                ? window.resolveCaretCharTarget(wordElement, wordIndex, charIndex, 'char')
                : (function () {
                    var target = document.getElementById('char-' + wordIndex + '-' + charIndex);
                    var after = false;
                    if (!target) {
                        target = document.getElementById('char-' + wordIndex + '-' + (charIndex - 1));
                        after = true;
                    }
                    return { target: target || wordElement, isAfter: after };
                })();
            var left;
            var top;
            var width;
            if (typeof window.getCaretLayoutInContainer === 'function') {
                var box = window.getCaretLayoutInContainer(
                    textContainer, wordElement, resolved.target, resolved.isAfter, isRtl
                );
                left = box.left;
                top = box.top;
                width = box.width;
            } else {
                var targetRect = resolved.target.getBoundingClientRect();
                var containerRect = textContainer.getBoundingClientRect();
                left = (typeof window.getCaretOffsetLeft === 'function')
                    ? window.getCaretOffsetLeft(targetRect, containerRect, resolved.isAfter, isRtl)
                    : (targetRect.left - containerRect.left + (resolved.isAfter ? targetRect.width : 0));
                top = targetRect.top - containerRect.top;
                width = targetRect.width;
            }
            element.style.display = 'block';
            element.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
            element.style.width = width + 'px';
        }

        function updateCaret() {
            handleScroll();
            positionCaretAt(caret, currentWordIndex, currentCharIndex);
            if (window.usertypo_settings?.keyboardLayout?.keymapMode === 'Next') {
                updateKeymapHighlight();
            }
            queueCursorSend(false);
        }

        function opponentCursorFresh() {
            return !!(lastOpponentCursorAt && (Date.now() - lastOpponentCursorAt) < OPPONENT_CURSOR_STALE_MS);
        }

        function opponentLerpTauSeconds() {
            return Math.max(0.05, OPPONENT_LERP_MS / 1000);
        }

        function cursorStateKey(wordIndex, charIndex) {
            return String(wordIndex) + ':' + String(charIndex);
        }

        function setOpponentTarget(wordIndex, charIndex, wpm) {
            opponentTargetWordIndex = Math.max(0, wordIndex);
            opponentTargetCharIndex = Math.max(0, charIndex);
            opponentTargetWpm = Math.max(0, Number(wpm) || 0);
            opponentTargetOffset = wordOffset(opponentTargetWordIndex) + opponentTargetCharIndex;
            opponentHasReport = true;
            noteOpponentCaret(opponentTargetWordIndex, opponentTargetCharIndex);
        }

        function snapOpponentDisplayPosition() {
            opponentDisplayWordIndex = opponentTargetWordIndex;
            opponentDisplayCharIndex = opponentTargetCharIndex;
            opponentDisplayOffset = opponentTargetOffset;
            paintOpponentCaret(opponentDisplayWordIndex, opponentDisplayCharIndex);
        }

        function estimateOpponentCharWidth(wordElement, wordIndex) {
            if (!wordElement) return 8;
            var first = document.getElementById('char-' + wordIndex + '-0');
            if (first && first.offsetWidth) return first.offsetWidth;
            var promptWord = words[wordIndex] || '';
            var promptLen = Math.max(1, promptWord.length);
            return (wordElement.offsetWidth || promptLen * 8) / promptLen;
        }

        function opponentCaretWidth(caretStyle, baseWidth, charWidth, extraCount) {
            caretStyle = (caretStyle || 'underscore').toLowerCase();
            if (extraCount <= 0) {
                if (caretStyle === 'line') return 2.5;
                return Math.max(baseWidth || charWidth, 8);
            }
            var extraSpan = extraCount * charWidth;
            if (caretStyle === 'line') {
                return Math.max(2.5, extraSpan + 2.5);
            }
            return Math.max(charWidth, extraSpan);
        }

        function getLiveCursorWpm() {
            if (!startTime || state !== 'racing') return 0;
            var stats = localStats();
            var elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            if (elapsedSec > lastLiveRawSecond) {
                lastLiveRawSecond = elapsedSec;
                liveRawSecondKeystrokes = totalKeystrokes;
            }
            var ksThisSec = totalKeystrokes - liveRawSecondKeystrokes;
            var liveRawWpm = Math.max(0, Math.round((ksThisSec / 5) * 60));
            return Math.max(stats.wpm, liveRawWpm);
        }

        function getCursorSyncState() {
            var wordIndex = Math.max(0, Math.min(currentWordIndex, Math.max(0, words.length - 1)));
            var word = words[wordIndex] || '';
            var maxChar = word.length + 12;
            return {
                wpm: getLiveCursorWpm(),
                wordIndex: wordIndex,
                charIndex: Math.max(0, Math.min(currentCharIndex, maxChar)),
            };
        }

        function queueCursorSend(force) {
            if (state !== 'racing' || isLocalBotMatch() || isBotMatch()) return;
            var sync = getCursorSyncState();
            var stateKey = cursorStateKey(sync.wordIndex, sync.charIndex);
            if (!force && stateKey === lastSentCursorKey) return;
            lastSentCursorKey = stateKey;
            lastCursorSentAt = Date.now();
            sendCursorPacket();
        }

        function animateOpponent(now) {
            if (state === 'finished') {
                opponentAnimationFrame = null;
                return;
            }
            if (!opponentFrameAt) opponentFrameAt = now;
            var elapsedSeconds = Math.min(0.1, Math.max(0, (now - opponentFrameAt) / 1000));
            opponentFrameAt = now;
            if (state === 'racing' || state === 'waiting-result') {
                var lerpAlpha = 1 - Math.exp(-elapsedSeconds / opponentLerpTauSeconds());

                if (opponentHasReport) {
                    opponentDisplayWpm += (opponentTargetWpm - opponentDisplayWpm) * lerpAlpha;
                    if (opponentTargetWpm <= 0 && opponentDisplayWpm < 0.5) opponentDisplayWpm = 0;
                }

                if (opponentWpmDisplay && opponentHasReport) {
                    opponentWpmDisplay.textContent = String(Math.round(opponentDisplayWpm));
                }
            }
            opponentAnimationFrame = requestAnimationFrame(animateOpponent);
        }

        function resetCharacter(wordIndex, charIndex) {
            var element = document.getElementById('char-' + wordIndex + '-' + charIndex);
            if (!element) return;
            if (element.classList.contains('extra')) {
                var wordElement = document.getElementById('word-' + wordIndex);
                var beforeWidth = wordElement ? wordElement.offsetWidth : 0;
                element.remove();
                extraChars = Math.max(0, extraChars - 1);
                if (wordElement && typeof window.compensateLetterTapeWidthDelta === 'function') {
                    window.compensateLetterTapeWidthDelta(textContainer, wordElement.offsetWidth - beforeWidth);
                }
                return;
            }
            element.className = 'char text-slate-500 transition-colors duration-75';
            element.textContent = words[wordIndex][charIndex] || '';
        }

        function paintCharacter(wordIndex, charIndex, typed, correct, forcedRed) {
            var wordElement = document.getElementById('word-' + wordIndex);
            if (!wordElement) return;
            var element = document.getElementById('char-' + wordIndex + '-' + charIndex);
            if (!element) {
                var beforeWidth = wordElement.offsetWidth;
                element = document.createElement('span');
                element.id = 'char-' + wordIndex + '-' + charIndex;
                element.className = 'char extra transition-colors duration-75';
                element.textContent = charIndex < words[wordIndex].length
                    ? words[wordIndex][charIndex]
                    : typed;
                wordElement.appendChild(element);
                extraChars += 1;
                if (typeof window.compensateLetterTapeWidthDelta === 'function') {
                    window.compensateLetterTapeWidthDelta(textContainer, wordElement.offsetWidth - beforeWidth);
                }
            } else {
                element.textContent = charIndex < words[wordIndex].length
                    ? words[wordIndex][charIndex]
                    : typed;
            }
            element.className = 'char transition-colors duration-75 ' + (
                correct && !forcedRed
                    ? 'text-primary drop-shadow-[0_0_5px_rgba(0,208,255,0.4)]'
                    : 'text-error drop-shadow-[0_0_7px_rgba(255,80,80,0.75)]'
            );
            if (charIndex >= words[wordIndex].length) element.classList.add('extra');
        }

        function currentCorrectChars() {
            var total = 0;
            for (var i = 0; i < completedCorrectWords && i < words.length; i += 1) {
                // Home-page stats count: each completed word includes its trailing space.
                total += words[i].length + 1;
            }
            var activeWord = document.getElementById('word-' + currentWordIndex);
            if (activeWord) {
                activeWord.querySelectorAll('.char.text-primary:not(.extra)').forEach(function () {
                    total += 1;
                });
            }
            return total;
        }

        function currentLocalWpm() {
            if (!startTime || Date.now() < startTime) return 0;
            return localStats().wpm;
        }

        function computeConsistencyFromRawHistory(history) {
            if (!Array.isArray(history) || history.length < 2) return 100;
            var mean = history.reduce(function (sum, value) { return sum + value; }, 0) / history.length;
            if (mean <= 0) return 100;
            var stdDev = Math.sqrt(history.map(function (x) { return Math.pow(x - mean, 2); })
                .reduce(function (sum, value) { return sum + value; }, 0) / history.length);
            var cov = stdDev / mean;
            var kogasa = 100 * (1 - Math.tanh(cov + Math.pow(cov, 3) / 3 + Math.pow(cov, 5) / 5));
            return Math.max(0, Math.min(100, Math.round(kogasa)));
        }

        function sampleRawHistorySecond(force) {
            if (!startTime) return;
            if (!force && state !== 'racing' && state !== 'waiting-result') return;
            var at = (force && localFinishTime) ? localFinishTime : Date.now();
            var elapsedSec = Math.floor((at - startTime) / 1000);
            if (elapsedSec <= lastRawHistorySecond) return;
            lastRawHistorySecond = elapsedSec;
            var ksThisSec = totalKeystrokes - lastSecondKeystrokes;
            lastSecondKeystrokes = totalKeystrokes;
            rawHistory.push(Math.max(0, Math.round((ksThisSec / 5) * 60)));
            var elapsedMin = Math.max((at - startTime) / 60000, 1 / 60);
            var avgWpm = Math.max(0, Math.round((currentCorrectChars() / 5) / elapsedMin));
            wpmHistory.push(avgWpm);
        }

        function caretCharOffset(wordIndex, charIndex) {
            var offset = 0;
            var wi = Math.max(0, Math.floor(Number(wordIndex) || 0));
            var ci = Math.max(0, Math.floor(Number(charIndex) || 0));
            for (var i = 0; i < wi && i < words.length; i += 1) {
                offset += (words[i] || '').length + 1;
            }
            if (wi < words.length) {
                var wlen = (words[wi] || '').length;
                offset += Math.min(ci, wlen + 12);
            }
            return Math.max(0, offset);
        }

        function flushOpponentHistorySecond() {
            var delta = Math.max(0, oppLatestOffset - oppOffsetAtSecondStart);
            oppRawHistory.push(Math.max(0, Math.round((delta / 5) * 60)));
            var elapsedMin = Math.max(oppLastHistorySecond / 60, 1 / 60);
            oppWpmHistory.push(Math.max(0, Math.round((oppLatestOffset / 5) / elapsedMin)));
            oppOffsetAtSecondStart = oppLatestOffset;
        }

        function noteOpponentCaret(wordIndex, charIndex) {
            if (!startTime || (state !== 'racing' && state !== 'waiting-result')) return;
            var now = Date.now();
            if (now < startTime) return;
            oppLatestOffset = caretCharOffset(wordIndex, charIndex);
            var elapsedSec = Math.floor((now - startTime) / 1000);
            while (oppLastHistorySecond < elapsedSec) {
                oppLastHistorySecond += 1;
                flushOpponentHistorySecond();
            }
        }

        function resetGraphHistories() {
            wpmHistory = [];
            rawHistory = [];
            lastRawHistorySecond = 0;
            lastSecondKeystrokes = 0;
            oppWpmHistory = [];
            oppRawHistory = [];
            oppLastHistorySecond = 0;
            oppLatestOffset = 0;
            oppOffsetAtSecondStart = 0;
            graphSeriesBySide = { w: null, l: null };
            graphSelectedSide = 'w';
            graphAnimationPlayed = false;
        }

        function finalizeSeries(wBase, rBase, endTime, finalWpm, finalRaw) {
            var avg = Math.max(0, Math.round(Number(finalWpm) || 0));
            var raw = Math.max(0, Math.round(Number(finalRaw) || 0));
            var wOut = (wBase || []).slice();
            var rOut = (rBase || []).slice();
            if (!startTime || endTime == null) {
                if (!wOut.length) {
                    wOut.push(avg);
                    rOut.push(raw);
                }
                return { wpmHistory: wOut, rawHistory: rOut };
            }
            var buckets = Math.max(1, Math.ceil((endTime - startTime) / 1000 - 1e-9));
            while (wOut.length < buckets) {
                wOut.push(avg);
                rOut.push(rOut.length ? rOut[rOut.length - 1] : raw);
            }
            while (rOut.length < wOut.length) {
                rOut.push(rOut.length ? rOut[rOut.length - 1] : raw);
            }
            while (rOut.length > wOut.length) rOut.pop();
            if (wOut.length) {
                wOut[wOut.length - 1] = avg;
                if (rOut.length === 1) rOut[0] = raw;
            }
            return { wpmHistory: wOut, rawHistory: rOut };
        }

        function finalizeSelfGraphHistory(endTime, finalWpm, finalRaw) {
            sampleRawHistorySecond(true);
            var series = finalizeSeries(wpmHistory, rawHistory, endTime, finalWpm, finalRaw);
            if (!series.wpmHistory.length) {
                series.wpmHistory = [Math.max(0, Math.round(Number(finalWpm) || 0))];
                series.rawHistory = [Math.max(0, Math.round(Number(finalRaw) || finalWpm || 0))];
            }
            return series;
        }

        function finalizeOpponentGraphHistory(endTime, finalWpm, finalRaw) {
            noteOpponentCaret(opponentTargetWordIndex, opponentTargetCharIndex);
            if (startTime && endTime != null) {
                var buckets = Math.max(1, Math.ceil((endTime - startTime) / 1000 - 1e-9));
                while (oppLastHistorySecond < buckets) {
                    oppLastHistorySecond += 1;
                    flushOpponentHistorySecond();
                }
            }
            var series = finalizeSeries(oppWpmHistory, oppRawHistory, endTime, finalWpm, finalRaw);
            if (!series.wpmHistory.length) {
                series.wpmHistory = [Math.max(0, Math.round(Number(finalWpm) || 0))];
                series.rawHistory = [Math.max(0, Math.round(Number(finalRaw) || finalWpm || 0))];
            }
            return series;
        }

        function computeFinalStats(finishTime) {
            var endTime = finishTime || Date.now();
            var validChars = 0;
            var rawChars = 0;
            var allWords = textContainer ? textContainer.querySelectorAll('.word') : [];
            allWords.forEach(function (wordEl, idx) {
                if (idx < currentWordIndex) {
                    var hasError = wordEl.querySelectorAll('.text-error, .error-underline, .extra').length > 0;
                    if (!hasError) {
                        validChars += wordEl.querySelectorAll('.char:not(.extra)').length + 1;
                    }
                    rawChars += wordEl.querySelectorAll('.char:not(.text-slate-500)').length + 1;
                } else if (idx === currentWordIndex) {
                    validChars += wordEl.querySelectorAll('.text-primary').length;
                    rawChars += wordEl.querySelectorAll('.char:not(.text-slate-500)').length;
                }
            });
            var elapsedSeconds = Math.floor((endTime - startTime) / 1000);
            var elapsedMinutes = Math.max((endTime - startTime) / 60000, 2 / 60);
            var exactWpm = (validChars / 5) / elapsedMinutes;
            var exactRawWpm = (rawChars / 5) / elapsedMinutes;
            var accuracy = totalKeystrokes > 0
                ? Math.max(0, ((totalKeystrokes - errorsMade) / totalKeystrokes) * 100)
                : 100;
            sampleRawHistorySecond();
            return {
                wpm: Math.max(0, Math.round(exactWpm)),
                raw: Math.max(0, Math.round(exactRawWpm)),
                accuracy: Math.round(accuracy * 10) / 10,
                consistency: computeConsistencyFromRawHistory(rawHistory),
                correct: validChars,
                total: rawChars,
                errors: errorsMade,
                extra: extraChars,
                time: elapsedSeconds,
            };
        }

        function parseServerResult(row) {
            if (!Array.isArray(row) || !row.length) return null;
            var validChars = Number(row[8]) || 0;
            var rawChars = Number(row[9]) || 0;
            var displayTime = row[12] != null ? Number(row[12]) || 0 : 0;
            var errorsMadeCount = row[13] != null ? Number(row[13]) || 0 : Math.max(0, rawChars - validChars);
            var extraCount = row[14] != null ? Number(row[14]) || 0 : 0;
            var elapsedMinutes = Math.max(displayTime / 60, 2 / 60);
            var exactWpm = row[3] != null ? Number(row[3]) : (validChars / 5) / elapsedMinutes;
            var exactRaw = row[10] != null ? Number(row[10]) : (rawChars / 5) / elapsedMinutes;
            var accuracy = row[4] != null ? Number(row[4]) : 100;
            return {
                wpm: Math.max(0, Math.round(exactWpm)),
                raw: Math.max(0, Math.round(exactRaw)),
                accuracy: Math.round(accuracy * 10) / 10,
                consistency: row[11] != null ? Number(row[11]) : 100,
                correct: validChars,
                total: rawChars,
                errors: errorsMadeCount,
                extra: extraCount,
                time: displayTime,
            };
        }

        function syncStatsHeaderUser() {
            if (!statsView) return;
            var profile = window.__USERTYPO_PROFILE__ || {};
            var authState = window.usertypoAuth && window.usertypoAuth.getState
                ? window.usertypoAuth.getState()
                : null;
            var name = profile.username
                || (authState && authState.user && authState.user.username)
                || 'Player';
            var tier = authState && authState.isSignedIn ? 'Signed in' : 'Guest';
            var initial = String(name || 'P').trim().charAt(0).toUpperCase() || 'P';
            var nameEl = statsView.querySelector('#dual-stats-user-name');
            var tierEl = statsView.querySelector('#dual-stats-user-tier');
            var avatarEl = statsView.querySelector('#dual-stats-user-avatar');
            if (nameEl) nameEl.textContent = name;
            if (tierEl) tierEl.textContent = tier;
            if (avatarEl && window.usertypoPlayerAvatar) {
                var progression = window.usertypoProgression && window.usertypoProgression.getCached
                    ? window.usertypoProgression.getCached()
                    : null;
                var photo = (profile && profile.avatar_url)
                    || (authState && authState.user && authState.user.hasImage === true && authState.user.imageUrl)
                    || '';
                avatarEl.outerHTML = window.usertypoPlayerAvatar.render({
                    id: 'dual-stats-user-avatar',
                    avatarUrl: photo,
                    name: name,
                    level: progression && progression.level || 1,
                    percentToNext: progression && progression.percentToNext || 0,
                    size: 'sm',
                    showLevel: !!(authState && authState.isSignedIn),
                    className: 'shrink-0',
                });
            } else if (avatarEl) {
                avatarEl.textContent = initial;
            }
        }

        function initStatsHeader() {
            if (!statsView || statsHeaderReady) return;
            statsHeaderReady = true;
            syncStatsHeaderUser();
            if (typeof window.usertypoInitExpandingBubble === 'function') {
                window.usertypoInitExpandingBubble(
                    statsView.querySelector('#dual-stats-expanding-bubble'),
                    statsView.querySelector('#dual-stats-bubble-toggle')
                );
            }
            var notificationsLink = statsView.querySelector('[data-dual-stats-notifications]');
            if (notificationsLink) {
                notificationsLink.addEventListener('click', function (event) {
                    event.preventDefault();
                    if (typeof window.openNotifications === 'function') window.openNotifications();
                }, { signal: signal });
            }
        }

        function localStats() {
            var elapsedMinutes = startTime ? Math.max((Date.now() - startTime) / 60_000, 1 / 120) : 1 / 120;
            var correct = currentCorrectChars();
            var wpm = Math.max(0, Math.round((correct / 5) / elapsedMinutes));
            var accuracy = totalKeystrokes
                ? Math.max(0, Math.min(100, ((totalKeystrokes - errorsMade) / totalKeystrokes) * 100))
                : 100;
            var consistency = computeConsistencyFromRawHistory(rawHistory);
            return {
                wpm: wpm,
                raw: Math.max(wpm, Math.round(((totalKeystrokes / 5) / elapsedMinutes))),
                accuracy: Math.round(accuracy * 10) / 10,
                consistency: consistency,
                correct: correct,
                total: totalKeystrokes,
                errors: errorsMade,
                extra: extraChars,
                time: startTime ? Math.round((Date.now() - startTime) / 100) / 10 : 0,
            };
        }

        function updateLiveStats() {
            if (state !== 'racing') return;
            sampleRawHistorySecond();
            var stats = localStats();
            if (wpmDisplay) wpmDisplay.textContent = stats.wpm;
            var elapsedSec = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
            if (elapsedSec > lastLiveRawSecond) {
                lastLiveRawSecond = elapsedSec;
                liveRawSecondKeystrokes = totalKeystrokes;
            }
            var ksThisSec = totalKeystrokes - liveRawSecondKeystrokes;
            var liveRawWpm = Math.max(0, Math.round((ksThisSec / 5) * 60));
            if (rawWpmDisplay) rawWpmDisplay.textContent = liveRawWpm;
            if (accDisplay) accDisplay.textContent = Math.round(stats.accuracy) + '%';
            if (burstDisplay) {
                var cutoff = Date.now() - 2000;
                correctKeystrokeTimes = correctKeystrokeTimes.filter(function (time) { return time >= cutoff; });
                burstDisplay.textContent = Math.round(correctKeystrokeTimes.length * 6);
            }
            if (config.mode === 'time') {
                var endAt = raceEndsAt();
                var remainingMs = Math.max(0, endAt - Date.now());
                var remaining = Math.max(0, Math.ceil(remainingMs / 1000));
                if (progressDisplay) progressDisplay.textContent = remaining;
                if (progressBar) {
                    var elapsed = Math.max(0, (Date.now() - startTime) / 1000);
                    progressBar.style.width = Math.min(100, (elapsed / config.amount) * 100) + '%';
                }
                if (remainingMs <= 0) {
                    localFinished = true;
                    localFinishTime = endAt;
                    state = 'waiting-result';
                    clearInterval(updateTimer);
                    stopCursorSync();
                    flushConsistencyReports();
                    if (isLocalBotMatch()) {
                        finishLocalBotRace('time');
                        return;
                    }
                    sendThreeWordPacket(true);
                    if (!isBotMatch()) {
                        showMessage(
                            'Finished',
                            opponentLeft
                                ? 'Opponent left. Calculating race results.'
                                : 'Calculating race results.'
                        );
                    }
                }
            } else {
                progressDisplay.innerHTML = completedCorrectWords + '<span class="text-slate-500">/</span>' + config.amount;
                if (progressBar) progressBar.style.width = Math.min(100, (completedCorrectWords / config.amount) * 100) + '%';
            }
        }

        function isLocalBotMatch() {
            return isLocalBot;
        }

        function isBotMatch() {
            return isLocalBotMatch() || matchReason === 'bot' || !!(bot && (bot.isBot !== false));
        }

        function getLocalUserId() {
            if (window.usertypoMultiplayer && typeof window.usertypoMultiplayer.getReadyState === 'function') {
                var ready = window.usertypoMultiplayer.getReadyState();
                if (ready && ready.userId) return ready.userId;
            }
            if (window.usertypoAuth && typeof window.usertypoAuth.getState === 'function') {
                var auth = window.usertypoAuth.getState();
                if (auth && auth.user && auth.user.id) return auth.user.id;
            }
            try {
                var guestKey = 'usertypo:guest-id';
                var guest = localStorage.getItem(guestKey);
                if (guest) return guest;
            } catch (_) { /* ignore */ }
            return 'guest_local';
        }

        function getLocalUserName() {
            var profile = window.__USERTYPO_PROFILE__ || {};
            if (profile.username) return profile.username;
            if (window.usertypoAuth && typeof window.usertypoAuth.getState === 'function') {
                var auth = window.usertypoAuth.getState();
                if (auth && auth.user && auth.user.username) {
                    return auth.user.username;
                }
            }
            return 'You';
        }

        function cumulativeCorrectChars(completedWords) {
            var total = 0;
            for (var i = 0; i < completedWords && i < words.length; i += 1) {
                total += words[i].length + 1;
            }
            return total;
        }

        function positionFromCompletedWords(count) {
            var safeCount = Math.max(0, Math.min(count, words.length));
            if (!words.length) return { wordIndex: 0, charIndex: 0 };
            if (safeCount >= words.length) {
                var last = words.length - 1;
                return { wordIndex: last, charIndex: words[last] ? words[last].length : 0 };
            }
            return { wordIndex: safeCount, charIndex: 0 };
        }

        function stopCursorSync() {
            if (cursorSyncTimer) clearInterval(cursorSyncTimer);
            cursorSyncTimer = null;
        }

        function startCursorSync() {
            if (isLocalBotMatch() || isBotMatch()) return;
            stopCursorSync();
            queueCursorSend(true);
            cursorSyncTimer = setInterval(function () {
                queueCursorSend(true);
            }, CURSOR_SYNC_INTERVAL_MS);
        }

        function sendCursorPacket() {
            if (state !== 'racing' || isLocalBotMatch()) return;
            var mp = window.usertypoMultiplayer;
            if (!mp || typeof mp.sendCursorState !== 'function') return;
            var sync = getCursorSyncState();
            mp.sendCursorState(roomId, sync.wpm, sync.wordIndex, sync.charIndex);
        }

        function stopLocalBotTimer() {
            if (localBotTimer) clearInterval(localBotTimer);
            localBotTimer = null;
        }

        function startLocalBotTimer() {
            if (!isLocalBotMatch()) return;
            stopLocalBotTimer();
            localBotTimer = setInterval(updateLocalBotPosition, 200);
        }

        function updateLocalBotPosition() {
            if (!bot || !startTime || (state !== 'racing' && state !== 'waiting-result')) return;
            var elapsedMinutes = Math.max((Date.now() - startTime) / 60000, 1 / 120);
            var targetChars = Math.floor(bot.targetWpm * 5 * elapsedMinutes);
            var completedWords = 0;
            while (
                completedWords < words.length
                && cumulativeCorrectChars(completedWords + 1) <= targetChars
            ) {
                completedWords += 1;
            }
            bot.completedWords = completedWords;
            var validChars = cumulativeCorrectChars(completedWords);
            bot.wpm = (validChars / 5) / elapsedMinutes;
            var position = offsetToPosition(targetChars);
            applyOpponentCursor([opponentIndex, bot.wpm, position.wordIndex, position.charIndex]);
            if (config.mode === 'words' && completedWords >= config.amount) {
                bot.finished = true;
                bot.finishedAt = Date.now();
                stopLocalBotTimer();
                maybeFinishLocalBotRace();
            }
        }

        function computeLocalBotFinalStats() {
            var finishedAt = bot && bot.finishedAt ? bot.finishedAt : Date.now();
            var displaySeconds = Math.max(0, Math.floor((finishedAt - startTime) / 1000));
            var elapsedMinutes = Math.max(displaySeconds / 60, 2 / 60);
            var validChars = cumulativeCorrectChars(bot ? bot.completedWords : 0);
            var rawChars = Math.ceil(validChars / ((bot && bot.accuracy) || 97) * 100);
            var errors = Math.max(0, rawChars - validChars);
            return {
                wpm: Math.max(0, Math.round((validChars / 5) / elapsedMinutes)),
                raw: Math.max(0, Math.round((rawChars / 5) / elapsedMinutes)),
                accuracy: Math.max(0, Math.min(100, Math.round((bot && bot.accuracy) || 97))),
                consistency: 100,
                correct: validChars,
                total: rawChars,
                errors: errors,
                extra: 0,
                time: displaySeconds,
            };
        }

        function buildLocalResultRow(index, userId, name, stats, progress, status, finishedAt, isBotPlayer) {
            return [
                index,
                userId,
                name,
                stats.wpm,
                stats.accuracy,
                progress,
                status,
                finishedAt,
                stats.correct,
                stats.total,
                stats.raw,
                stats.consistency,
                stats.time,
                stats.errors,
                stats.extra,
                isBotPlayer ? 1 : 0,
            ];
        }

        function finishLocalBotRace(reason) {
            if (!isLocalBotMatch() || state === 'finished') return;
            stopLocalBotTimer();
            stopCursorSync();
            clearInterval(updateTimer);
            updateLocalBotPosition();
            var meStats = computeFinalStats(localFinishTime || Date.now());
            var botStats = computeLocalBotFinalStats();
            var myProgress = config.mode === 'words'
                ? Math.min(100, Math.round((completedCorrectWords / config.amount) * 100))
                : 100;
            var botProgress = config.mode === 'words'
                ? Math.min(100, Math.round(((bot && bot.completedWords) || 0) / config.amount * 100))
                : 100;
            var rows = [
                buildLocalResultRow(
                    selfIndex,
                    selfUserId,
                    getLocalUserName(),
                    meStats,
                    myProgress,
                    'finished',
                    localFinishTime || Date.now(),
                    false
                ),
                buildLocalResultRow(
                    opponentIndex,
                    'bot',
                    bot && bot.name || 'TypeBot',
                    botStats,
                    botProgress,
                    'finished',
                    bot && bot.finishedAt || Date.now(),
                    true
                ),
            ];
            rows.sort(function (a, b) {
                if (b[3] !== a[3]) return b[3] - a[3];
                if (b[4] !== a[4]) return b[4] - a[4];
                return (a[7] || 0) - (b[7] || 0);
            });
            showResults([roomId, reason || 'complete', rows, 0, 'bot']);
        }

        function maybeFinishLocalBotRace() {
            if (!isLocalBotMatch() || state === 'finished') return;
            if (!localFinished) return;
            if (config.mode === 'words' && !(bot && bot.finished)) return;
            finishLocalBotRace(config.mode === 'time' ? 'time' : 'complete');
        }

        function buildLocalRacePayload(promptWords) {
            var startsAt = Date.now() + 7000;
            return {
                roomId: roomId,
                config: config,
                words: promptWords,
                startsAt: startsAt,
                startsInMs: Math.max(0, startsAt - Date.now()),
                endsAt: config.mode === 'time' ? startsAt + (config.amount * 1000) : null,
                players: players,
                bot: bot,
            };
        }

        async function restartLocalBotRace() {
            if (!window.usertypoLocalPrompt || typeof window.usertypoLocalPrompt.createPrompt !== 'function') {
                throw new Error('Local prompt generator is unavailable.');
            }
            resetLocalRaceState();
            rematchNeeded = 1;
            abortCountdownIntro();
            countdownSequenceStarted = false;
            pendingRacePayload = null;
            state = 'joining';
            bot.targetWpm = 55 + Math.floor(Math.random() * 61);
            bot.accuracy = 97 + Math.floor(Math.random() * 4);
            bot.completedWords = 0;
            bot.finished = false;
            bot.finishedAt = 0;
            var prompt = await window.usertypoLocalPrompt.createPrompt(config);
            pendingRacePayload = buildLocalRacePayload(prompt.words);
            rematchVotes = 0;
            selfRematchVoted = false;
            updateRematchButton();
            prepareWaitingTestView();
            ensureCountdownSequence();
        }

        async function initLocalBotRace() {
            var raceConfig = null;
            try {
                var stored = sessionStorage.getItem('usertypo:local-bot-config');
                if (stored) raceConfig = JSON.parse(stored);
            } catch (_) { /* ignore */ }
            if (!raceConfig) {
                var pending = window.DualMatch && typeof window.DualMatch.loadRequest === 'function'
                    ? window.DualMatch.loadRequest()
                    : null;
                raceConfig = pending && pending.config;
            }
            if (!raceConfig || !window.usertypoLocalPrompt) {
                if (typeof window.navigateTo === 'function') window.navigateTo('/multiplayer');
                return;
            }
            config = raceConfig;
            matchReason = 'bot';
            bindDualKeymapRenderArgs();
            setDualFooterMode('test-compact');
            setDualHeaderInteractive(false);
            wireZenHandlers();
            bindResultActions();
            window.addEventListener('resize', function () {
                if (!words.length) return;
                if (state === 'countdown' || state === 'joining') {
                    syncCountdownLayout(!!document.getElementById('char-0-0')
                        && document.getElementById('char-0-0').style.opacity !== '0');
                    syncDualKeymapLayout();
                    return;
                }
                updateLineLayout();
                updateCaret();
                syncDualKeymapLayout();
            }, { signal: signal });
            selfUserId = getLocalUserId();
            players = [
                {
                    index: 0,
                    userId: selfUserId,
                    name: getLocalUserName(),
                    avatarUrl: (window.__USERTYPO_PROFILE__ && window.__USERTYPO_PROFILE__.avatar_url) || '',
                },
                {
                    index: 1,
                    userId: 'bot',
                    name: 'TypeBot',
                    isBot: true,
                },
            ];
            selfIndex = 0;
            opponentIndex = 1;
            bot = {
                index: 1,
                name: 'TypeBot',
                isBot: true,
                targetWpm: 55 + Math.floor(Math.random() * 61),
                accuracy: 97 + Math.floor(Math.random() * 4),
                completedWords: 0,
                finished: false,
                finishedAt: 0,
            };
            rematchNeeded = 1;
            try {
                var prompt = await window.usertypoLocalPrompt.createPrompt(raceConfig);
                pendingRacePayload = buildLocalRacePayload(prompt.words);
                paintDualOpponentAvatar(players[1]);
                prepareWaitingTestView();
                ensureCountdownSequence();
            } catch (error) {
                showMessage('Could not start bot dual', error.message || 'Prompt generation failed.');
                setTimeout(function () {
                    if (typeof window.navigateTo === 'function') window.navigateTo('/multiplayer');
                }, 1800);
            }
        }

        function closeDualToFriends(toastMessage, toastIcon) {
            if (closingDual) return;
            closingDual = true;
            if (toastMessage && window.usertypoNotifications) {
                window.usertypoNotifications.showToast(toastMessage, toastIcon || 'person_remove');
            }
            leaveDual();
        }

        function buildProgressStats(isFinal) {
            sampleRawHistorySecond();
            var consistency = computeConsistencyFromRawHistory(rawHistory);
            reportConsistencyToServer(consistency);
            if (isFinal) {
                var snapshot = computeFinalStats(localFinishTime || Date.now());
                reportConsistencyToServer(snapshot.consistency);
                return [
                    snapshot.correct,
                    snapshot.total,
                    snapshot.errors,
                    snapshot.extra,
                    snapshot.time,
                    snapshot.consistency,
                ];
            }
            return [0, 0, 0, 0, 0, consistency];
        }

        function reportConsistencyToServer(consistency) {
            if (isLocalBotMatch() || isBotMatch() || !roomId || !window.usertypoMultiplayer) return;
            if (typeof window.usertypoMultiplayer.reportConsistency !== 'function') return;
            window.usertypoMultiplayer.reportConsistency(roomId, consistency).catch(function () { /* ignore */ });
        }

        function flushConsistencyReports() {
            sampleRawHistorySecond();
            var consistency = computeConsistencyFromRawHistory(rawHistory);
            reportConsistencyToServer(consistency);
            setTimeout(function () { reportConsistencyToServer(consistency); }, 350);
            setTimeout(function () {
                var latest = computeConsistencyFromRawHistory(rawHistory);
                reportConsistencyToServer(latest);
            }, 1000);
        }

        function sendThreeWordPacket(forceFinal) {
            if (state !== 'racing' && state !== 'waiting-result') return;
            if (isLocalBotMatch()) return;
            if (!window.usertypoMultiplayer) return;
            // Bot matches: never stream live progress — only the final packet so the
            // server can settle results / rematch. No intermediate race:progress traffic.
            if (isBotMatch() && forceFinal !== true) return;
            var shouldSend = (completedCorrectWords > 0 && completedCorrectWords % 3 === 0)
                || forceFinal === true;
            if (!shouldSend) return;
            var lastQueued = packetQueue.length ? packetQueue[packetQueue.length - 1] : null;
            if (!lastQueued || lastQueued.words !== completedCorrectWords || (forceFinal && !lastQueued.final)) {
                packetQueue.push({
                    words: completedCorrectWords,
                    keystrokes: totalKeystrokes,
                    final: forceFinal === true,
                    finalStats: buildProgressStats(forceFinal === true),
                    attempts: 0,
                });
            }
            processPacketQueue();
        }

        function processPacketQueue() {
            if (packetSending || !packetQueue.length) return;
            var packet = packetQueue[0];
            var nextSequence = packetSequence + 1;
            packetSending = true;
            window.usertypoMultiplayer
                .sendProgress(roomId, nextSequence, packet.words, packet.keystrokes, packet.final, packet.finalStats)
                .then(function () {
                    packetSequence = nextSequence;
                    packetQueue.shift();
                    packetSending = false;
                    processPacketQueue();
                })
                .catch(function (error) {
                    packetSending = false;
                    packet.attempts += 1;
                    if (packet.attempts < 3 && (state === 'racing' || state === 'waiting-result')) {
                        setTimeout(processPacketQueue, 400 * packet.attempts);
                        return;
                    }
                    packetQueue.shift();
                    if (window.usertypoNotifications) {
                        window.usertypoNotifications.showToast(error.message, 'error');
                    }
                    processPacketQueue();
                });
        }

        function completeWord() {
            completedCorrectWords += 1;
            currentWordIndex += 1;
            currentCharIndex = 0;
            unresolvedError = null;
            errorHistory = [];
            var finalWord = config.mode === 'words' && completedCorrectWords >= config.amount;
            if (finalWord) {
                localFinished = true;
                localFinishTime = Date.now();
            }
            if (finalWord) flushConsistencyReports();
            sendThreeWordPacket(finalWord);
            if (finalWord) {
                state = 'waiting-result';
                stopCursorSync();
                if (isLocalBotMatch()) {
                    showMessage(
                        'Finished',
                        bot && bot.finished
                            ? 'Calculating race results.'
                            : 'Waiting for TypeBot to finish.'
                    );
                    maybeFinishLocalBotRace();
                    return;
                }
                showMessage(
                    'Finished',
                    opponentLeft
                        ? 'Opponent left. Calculating race results.'
                        : (isBotMatch()
                            ? 'Calculating race results.'
                            : 'Waiting for your opponent to complete the test.')
                );
                return;
            }
            updateCaret();
        }

        function handleBackspace(event) {
            event.preventDefault();
            if (unresolvedError && errorHistory.length) {
                var errorEntry = errorHistory.pop();
                if (errorEntry.kind === 'space') {
                    // Remove error-underlines from skipped chars
                    var skipWord = words[errorEntry.wordIndex];
                    for (var ri = errorEntry.charIndex; ri < skipWord.length; ri++) {
                        var uel = document.getElementById('char-' + errorEntry.wordIndex + '-' + ri);
                        if (uel) uel.classList.remove('error-underline');
                    }
                    currentWordIndex = errorEntry.wordIndex;
                    currentCharIndex = errorEntry.charIndex;
                } else {
                    currentWordIndex = errorEntry.wordIndex;
                    currentCharIndex = errorEntry.charIndex;
                    resetCharacter(currentWordIndex, currentCharIndex);
                }
                if (!errorHistory.length) unresolvedError = null;
                if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound('Backspace');
                updateCaret();
                return;
            }
            if (currentCharIndex <= 0) return;
            if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound('Backspace');
            currentCharIndex -= 1;
            resetCharacter(currentWordIndex, currentCharIndex);
            updateCaret();
        }

        function handlePrintable(event) {
            if (state !== 'racing' || localFinished) return;
            var key = event.key === 'Spacebar' ? ' ' : event.key;
            if (key.length !== 1) return;
            event.preventDefault();
            var word = words[currentWordIndex];
            if (!word) return;

            if (unresolvedError) {
                if (errorHistory.length >= 20) return;
                totalKeystrokes += 1;
                keystrokeTimes.push(Date.now());
                if (key === ' ' && currentCharIndex >= word.length && words[currentWordIndex + 1]) {
                    errorHistory.push({
                        kind: 'space',
                        wordIndex: currentWordIndex,
                        charIndex: currentCharIndex,
                    });
                    currentWordIndex += 1;
                    currentCharIndex = 0;
                } else {
                    errorHistory.push({
                        kind: 'char',
                        wordIndex: currentWordIndex,
                        charIndex: currentCharIndex,
                    });
                    paintCharacter(currentWordIndex, currentCharIndex, key, false, true);
                    currentCharIndex += 1;
                }
                if (typeof window.playErrorSound === 'function') window.playErrorSound(key);
                errorsMade += 1;
                updateCaret();
                return;
            }

            totalKeystrokes += 1;
            keystrokeTimes.push(Date.now());
            if (key === ' ') {
                if (currentCharIndex === 0) return; // no space as first letter
                if (currentCharIndex === word.length) {
                    // Word fully typed — advance normally
                    if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(key);
                    correctKeystrokeTimes.push(Date.now());
                    completeWord();
                    return;
                }
                // Space mid-word: lock and skip to next word
                if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(key);
                unresolvedError = { wordIndex: currentWordIndex, charIndex: currentCharIndex };
                errorHistory = [];
                // Underline remaining chars visually + count as errors
                for (var si = currentCharIndex; si < word.length; si++) {
                    var el = document.getElementById('char-' + currentWordIndex + '-' + si);
                    if (el) el.classList.add('error-underline');
                }
                var skippedCount = word.length - currentCharIndex;
                errorsMade += skippedCount;
                totalKeystrokes += skippedCount;
                // Single space entry — one backspace returns to where user was
                if (words[currentWordIndex + 1]) {
                    errorHistory.push({
                        kind: 'space',
                        wordIndex: currentWordIndex,
                        charIndex: currentCharIndex,
                    });
                    currentWordIndex += 1;
                    currentCharIndex = 0;
                }
                updateCaret();
                return;
            }

            var expected = word[currentCharIndex];
            if (key === expected) {
                paintCharacter(currentWordIndex, currentCharIndex, key, true, false);
                correctKeystrokeTimes.push(Date.now());
                if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(key);
            } else {
                if (typeof window.playErrorSound === 'function') window.playErrorSound(key);
                unresolvedError = { wordIndex: currentWordIndex, charIndex: currentCharIndex };
                errorHistory = [{
                    kind: 'char',
                    wordIndex: currentWordIndex,
                    charIndex: currentCharIndex,
                }];
                paintCharacter(currentWordIndex, currentCharIndex, key, false, true);
                errorsMade += 1;
            }
            currentCharIndex += 1;
            if (
                !unresolvedError
                && config.mode === 'words'
                && currentWordIndex === config.amount - 1
                && currentCharIndex === word.length
            ) {
                completeWord();
                return;
            }
            updateCaret();
        }

        function onKeyDown(event) {
            if (state !== 'racing') return;
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                return;
            }
            zenTypingActive = true;
            hideZenElements();
            updateKeymapHighlight(event.key, true);
            if (event.key === 'Backspace') handleBackspace(event);
            else handlePrintable(event);
        }

        function bindRaceKeys() {
            if (raceKeysBound) return;
            raceKeysBound = true;
            document.addEventListener('keydown', onKeyDown, { signal: signal });
            document.addEventListener('keyup', function (event) {
                if (window.usertypo_footerPicker?.isOpen()) return;
                if (state !== 'racing') return;
                updateKeymapHighlight(event.key, false);
            }, { signal: signal });
        }

        function resetLocalRaceState() {
            clearInterval(updateTimer);
            updateTimer = null;
            if (opponentAnimationFrame) cancelAnimationFrame(opponentAnimationFrame);
            opponentAnimationFrame = null;
            currentWordIndex = 0;
            currentCharIndex = 0;
            completedCorrectWords = 0;
            packetSequence = 0;
            packetQueue = [];
            packetSending = false;
            totalKeystrokes = 0;
            errorsMade = 0;
            extraChars = 0;
            liveRawSecondKeystrokes = 0;
            lastLiveRawSecond = 0;
            resetGraphHistories();
            keystrokeTimes = [];
            correctKeystrokeTimes = [];
            unresolvedError = null;
            errorHistory = [];
            opponentLeft = false;
            localFinished = false;
            latestResults = null;
            opponentOffset = 0;
            opponentTargetOffset = 0;
            opponentDisplayOffset = 0;
            opponentDisplayWordIndex = 0;
            opponentDisplayCharIndex = 0;
            opponentDisplayWpm = 0;
            opponentTargetWpm = 0;
            opponentTargetWordIndex = 0;
            opponentTargetCharIndex = 0;
            opponentHasReport = false;
            opponentFrameAt = 0;
            lastOpponentCursorAt = 0;
            lastCursorSentAt = 0;
            lastSentCursorKey = '';
            localFinishTime = 0;
            rematchVotes = 0;
            rematchNeeded = 2;
            selfRematchVoted = false;
            if (wpmDisplay) wpmDisplay.textContent = '0';
            if (rawWpmDisplay) rawWpmDisplay.textContent = '0';
            if (accDisplay) accDisplay.textContent = '0%';
            if (burstDisplay) burstDisplay.textContent = '0';
            if (opponentWpmDisplay) opponentWpmDisplay.textContent = '0';
            document.querySelectorAll('.typing-stat').forEach(function (element) {
                element.classList.add('opacity-0');
            });
            if (caret) caret.classList.add('animate-breath');
        }

        function updateRematchButton() {
            var button = document.getElementById('rematch-btn');
            var label = document.getElementById('rematch-btn-label');
            if (label) {
                label.textContent = rematchVotes > 0
                    ? ('Rematch (' + rematchVotes + '/' + rematchNeeded + ')')
                    : 'Rematch';
            }
            if (button) {
                var disabled = !!selfRematchVoted || (!!opponentLeft && !isBotMatch());
                button.disabled = disabled;
                if (disabled) button.setAttribute('aria-disabled', 'true');
                else button.removeAttribute('aria-disabled');
            }
        }

        function leaveStatsForRematch() {
            resetLocalRaceState();
            abortCountdownIntro();
            countdownSequenceStarted = false;
            pendingRacePayload = null;
            state = 'joining';
            if (statsView) {
                statsView.classList.add('hidden', 'opacity-0');
                statsView.classList.remove('flex');
                statsView.style.display = 'none';
                var notice = statsView.querySelector('[data-dual-opponent-left-notice]');
                if (notice) notice.remove();
            }
            if (testView) {
                testView.classList.remove('hidden');
                testView.style.display = '';
            }
            setDualHeaderInteractive(false);
            setDualFooterMode('test-compact');
            updateRematchButton();
            prepareWaitingTestView();
        }

        function delay(ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }

        function waitForLayout() {
            return new Promise(function (resolve) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(resolve);
                });
            });
        }

        function parseTranslateX(transform) {
            var value = String(transform || '');
            var match = value.match(/translateX\(([-\d.]+)px\)/)
                || value.match(/translate3d\(([-\d.]+)px/);
            return match ? Number(match[1]) || 0 : 0;
        }

        function raceUnlockDelayMs(payload) {
            if (!payload) return 0;
            // Prefer relative delay so clock skew cannot delay typing unlock.
            if (payload.startsInMs != null && Number.isFinite(Number(payload.startsInMs))) {
                return Math.max(0, Number(payload.startsInMs));
            }
            if (payload.startsAt) return Math.max(0, Number(payload.startsAt) - Date.now());
            return 0;
        }

        function racePayloadStartsAt(payload) {
            if (!payload) return Date.now();
            return Date.now() + raceUnlockDelayMs(payload);
        }

        function racePayloadEndsAt(payload) {
            if (!payload) return 0;
            if (payload.endsAt) return Number(payload.endsAt);
            var starts = racePayloadStartsAt(payload);
            var amount = payload.config && payload.config.mode === 'time'
                ? Number(payload.config.amount) || 0
                : 0;
            return amount > 0 ? starts + (amount * 1000) : 0;
        }

        function raceEndsAt() {
            if (config && config.mode === 'time' && startTime) {
                return startTime + (Number(config.amount) || 0) * 1000;
            }
            return 0;
        }

        function syncCountdownLayout(digitVisible) {
            if (!textContainer || !typingArea) return;
            currentWordIndex = 0;
            var tapeMode = getTapeMode();
            var isTape = tapeMode === 'word' || tapeMode === 'letter';

            if (isTape) {
                if (!countdownTapeLocked) {
                    currentCharIndex = 0;
                    updateLineLayout();
                    countdownTapeTransform = textContainer.style.transform || '';
                    countdownTapeBaseX = parseTranslateX(countdownTapeTransform);
                    textContainer.style.transition = 'filter 0.3s ease-in-out, opacity 0.5s ease-in-out, transform 0s';
                    countdownTapeLocked = true;
                    positionCaretAt(caret, 0, 0);
                } else {
                    currentCharIndex = digitVisible ? 1 : 0;
                    var digitEl = document.getElementById('char-0-0');
                    var digitWidth = (digitVisible && digitEl) ? digitEl.getBoundingClientRect().width : 0;
                    textContainer.style.transform = 'translateX(' + (countdownTapeBaseX - digitWidth) + 'px)';
                    positionCaretAt(caret, 0, currentCharIndex);
                }
            } else {
                currentCharIndex = digitVisible ? 1 : 0;
                updateLineLayout();
                updateCaret();
            }
            if (caret) caret.style.display = 'block';
        }

        function seedProgressChrome() {
            if (!config) return;
            if (wpmDisplay) wpmDisplay.textContent = '0';
            if (accDisplay) accDisplay.textContent = '100%';
            if (opponentWpmDisplay) opponentWpmDisplay.textContent = '0';
            if (config.mode === 'time') {
                if (progressDisplay) progressDisplay.textContent = String(config.amount);
                if (progressBar) progressBar.style.width = '0%';
            } else if (progressDisplay) {
                progressDisplay.innerHTML = '0<span class="text-slate-500">/</span>' + config.amount;
                if (progressBar) progressBar.style.width = '0%';
            }
        }

        function showTestChrome() {
            document.querySelectorAll('#test-view .typing-stat').forEach(function (element) {
                element.classList.remove('opacity-0');
            });
            seedProgressChrome();
            if (typeof window.applyDualLiveFeedSettings === 'function') {
                window.applyDualLiveFeedSettings();
            }
        }

        function applyDualLiveFeedSettings() {
            var settings = window.usertypo_settingsApi
                ? window.usertypo_settingsApi.loadSettings()
                : window.usertypo_settings;
            var lf = (settings && settings.liveFeed) || {};
            var liveSegments = [
                { wrapperId: 'live-wpm-wrapper', dividerId: 'live-wpm-divider', show: lf.liveWpm !== false },
                { wrapperId: 'live-raw-wrapper', dividerId: 'live-raw-divider', show: lf.liveRawWpm === true },
                { wrapperId: 'live-burst-wrapper', dividerId: 'live-burst-divider', show: lf.liveBurst === true },
                { wrapperId: 'live-acc-wrapper', dividerId: null, show: lf.liveAccuracy !== false },
            ];
            liveSegments.forEach(function (segment, index) {
                var wrapper = document.getElementById(segment.wrapperId);
                if (wrapper) wrapper.classList.toggle('hidden', !segment.show);
                if (!segment.dividerId) return;
                var hasVisibleAfter = liveSegments.slice(index + 1).some(function (next) { return next.show; });
                var divider = document.getElementById(segment.dividerId);
                if (divider) divider.classList.toggle('hidden', !(segment.show && hasVisibleAfter));
            });

            var timerStyle = lf.timerStyle || 'Number';
            var timerOpacity = parseFloat(lf.timerOpacity || '0.5');
            if (!Number.isFinite(timerOpacity)) timerOpacity = 0.5;
            var wrapper = document.getElementById('timer-progress-wrapper');
            var progressText = document.getElementById('word-progress');
            var barContainer = document.getElementById('word-progress-bar-container');
            var liveStats = document.getElementById('live-stats-container');
            var showChrome = state === 'racing'
                || state === 'waiting-result'
                || state === 'countdown'
                || state === 'joining';

            if (wrapper) {
                if (timerStyle === 'Off') {
                    wrapper.style.visibility = 'hidden';
                } else {
                    wrapper.style.visibility = 'visible';
                    if (timerStyle === 'Bar') {
                        if (progressText) progressText.classList.add('hidden');
                        if (barContainer) barContainer.classList.remove('hidden');
                    } else {
                        if (progressText) progressText.classList.remove('hidden');
                        if (barContainer) barContainer.classList.add('hidden');
                    }
                }
                wrapper.style.opacity = showChrome ? String(timerOpacity) : '';
            }
            if (liveStats) {
                liveStats.classList.toggle('opacity-0', !showChrome);
                if (showChrome) {
                    liveStats.style.opacity = String(timerOpacity);
                    liveStats.classList.remove('opacity-0');
                } else {
                    liveStats.style.opacity = '';
                }
            }
            if (showChrome) {
                document.querySelectorAll('#test-view .typing-stat').forEach(function (element) {
                    element.classList.remove('opacity-0');
                });
            }
        }

        function prepareWaitingTestView() {
            hideMessage();
            countdownTapeLocked = false;
            countdownTapeTransform = '';
            countdownTapeBaseX = 0;
            words = ['0'];
            wordOffsets = [0];
            currentWordIndex = 0;
            currentCharIndex = 0;
            if (opponentCaret) opponentCaret.style.display = 'none';
            if (textContainer) {
                textContainer.querySelectorAll('.word').forEach(function (element) { element.remove(); });
                textContainer.style.transform = '';
                textContainer.style.transition = '';
                appendWord('0', 0);
                var placeholder = document.getElementById('char-0-0');
                if (placeholder) {
                    placeholder.style.opacity = '0';
                    placeholder.setAttribute('data-countdown-ph', '1');
                }
            }
            if (caret) {
                caret.classList.add('animate-breath');
                caret.style.display = 'block';
            }
            ensureDualKeymapHook();
            applyDualTestSettings();
            showTestChrome();
            requestAnimationFrame(function () {
                syncCountdownLayout(false);
                syncDualKeymapLayout();
            });
        }

        function prepareCountdownTestView() {
            prepareWaitingTestView();
            state = 'countdown';
            showTestChrome();
        }

        async function typeCountdownDigit(digit, token) {
            var el = document.getElementById('char-0-0');
            if (!el || token !== countdownAnimToken) return;
            el.style.opacity = '1';
            el.textContent = digit;
            el.className = 'char text-primary drop-shadow-[0_0_5px_rgba(0,208,255,0.4)] transition-colors duration-75';
            if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(digit);
            syncCountdownLayout(true);
        }

        async function backspaceCountdownDigit(token) {
            var el = document.getElementById('char-0-0');
            if (!el || token !== countdownAnimToken) return;
            if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound('Backspace');
            el.style.opacity = '0';
            el.textContent = '0';
            el.className = 'char text-slate-500 transition-colors duration-75';
            syncCountdownLayout(false);
        }

        function beginRaceIfAlreadyLive() {
            // Skip leftover countdown when the server race is already live (e.g. background tab).
            if (!pendingRacePayload || state === 'finished' || state === 'racing') {
                return false;
            }
            if (Date.now() < racePayloadStartsAt(pendingRacePayload) - 50) return false;
            var payload = pendingRacePayload;
            pendingRacePayload = null;
            abortCountdownIntro();
            countdownSequenceStarted = true;
            introBusy = false;
            beginActualRace(payload);
            return true;
        }

        // Fixed local 3→2→1 tape animation (type → hold → backspace → gap).
        // Race unlock still uses shared startsAt via startRace / beginRaceIfAlreadyLive.
        async function runCountdownIntroSequence() {
            var token = ++countdownAnimToken;
            introBusy = true;
            await waitForLayout();
            if (token !== countdownAnimToken) return;
            syncCountdownLayout(false);
            if (caret) caret.classList.add('animate-breath');
            await delay(650);
            if (token !== countdownAnimToken) return;
            if (beginRaceIfAlreadyLive()) return;

            var digits = ['3', '2', '1'];
            for (var i = 0; i < digits.length; i += 1) {
                if (token !== countdownAnimToken) return;
                if (beginRaceIfAlreadyLive()) return;
                if (caret) caret.classList.remove('animate-breath');
                await typeCountdownDigit(digits[i], token);
                if (token !== countdownAnimToken) return;
                if (beginRaceIfAlreadyLive()) return;
                await delay(1000);
                if (token !== countdownAnimToken) return;
                if (beginRaceIfAlreadyLive()) return;
                await backspaceCountdownDigit(token);
                if (token !== countdownAnimToken) return;
                if (beginRaceIfAlreadyLive()) return;
                if (caret) caret.classList.add('animate-breath');
                await delay(280);
            }
            if (token !== countdownAnimToken) return;
            introBusy = false;
            tryBeginRaceAfterIntro();
        }

        function ensureCountdownSequence() {
            if (countdownSequenceStarted) return;
            if (state === 'finished' || state === 'racing') return;
            countdownSequenceStarted = true;
            prepareCountdownTestView();
            runCountdownIntroSequence();
        }

        function abortCountdownIntro() {
            countdownAnimToken += 1;
            introBusy = false;
            countdownTapeLocked = false;
            countdownTapeTransform = '';
            countdownTapeBaseX = 0;
        }

        function tryBeginRaceAfterIntro() {
            if (introBusy) return;
            if (!pendingRacePayload) return;
            var payload = pendingRacePayload;
            pendingRacePayload = null;
            beginActualRace(payload);
        }

        function startRace(payload) {
            if (!payload || payload.roomId !== roomId) return;
            if (state === 'finished') return;
            pendingRacePayload = payload;
            if (beginRaceIfAlreadyLive()) return;
            // Don't wait for leftover local intro frames — unlock on the shared start clock.
            abortCountdownIntro();
            countdownSequenceStarted = true;
            introBusy = false;
            var ready = pendingRacePayload;
            pendingRacePayload = null;
            beginActualRace(ready);
        }

        function beginActualRace(payload) {
            if (!payload || payload.roomId !== roomId) return;
            if (state === 'racing' || state === 'finished') return;
            raceStartToken += 1;
            var token = raceStartToken;
            applyDualRaceConfig(payload.config);
            words = payload.words || [];
            bindDualKeymapRenderArgs();
            window.updateKeymapHighlight = updateKeymapHighlight;
            players = payload.players || [];
            bot = payload.bot || null;
            // Local unlock clock from relative delay — avoids skew delaying typing.
            var unlockDelay = raceUnlockDelayMs(payload);
            startTime = Date.now() + unlockDelay;
            selfUserId = (window.usertypoMultiplayer && window.usertypoMultiplayer.getReadyState()
                && window.usertypoMultiplayer.getReadyState().userId) || getLocalUserId();
            var self = players.find(function (player) { return player.userId === selfUserId; });
            var opponent = players.find(function (player) { return player.userId !== selfUserId; });
            selfIndex = self ? self.index : 0;
            opponentIndex = opponent ? opponent.index : (bot ? bot.index : 1);
            paintDualOpponentAvatar(opponent);
            if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                window.usertypoProgression.attachToList(players, 'userId').then(function () {
                    if (token !== raceStartToken) return;
                    opponent = players.find(function (player) { return player.userId !== selfUserId; });
                    paintDualOpponentAvatar(opponent);
                }).catch(function () { /* ignore */ });
            }
            currentWordIndex = 0;
            currentCharIndex = 0;
            completedCorrectWords = 0;
            packetSequence = 0;
            packetQueue = [];
            packetSending = false;
            totalKeystrokes = 0;
            errorsMade = 0;
            extraChars = 0;
            liveRawSecondKeystrokes = 0;
            lastLiveRawSecond = 0;
            resetGraphHistories();
            keystrokeTimes = [];
            correctKeystrokeTimes = [];
            unresolvedError = null;
            errorHistory = [];
            localFinished = false;
            opponentOffset = 0;
            opponentTargetOffset = 0;
            opponentDisplayOffset = 0;
            opponentDisplayWordIndex = 0;
            opponentDisplayCharIndex = 0;
            opponentDisplayWpm = 0;
            opponentTargetWpm = 0;
            opponentTargetWordIndex = 0;
            opponentTargetCharIndex = 0;
            opponentHasReport = false;
            opponentFrameAt = 0;
            lastOpponentCursorAt = 0;
            lastCursorSentAt = 0;
            lastSentCursorKey = '';
            localFinishTime = 0;
            countdownAnimToken += 1;
            introBusy = false;
            countdownSequenceStarted = false;
            countdownTapeLocked = false;
            countdownTapeTransform = '';
            countdownTapeBaseX = 0;
            hideMessage();
            if (textContainer) textContainer.style.transition = '';
            renderPrompt();
            showTestChrome();
            requestAnimationFrame(function () {
                updateLineLayout();
                resetOpponentCaretInstant();
            });
            if (opponentAnimationFrame) cancelAnimationFrame(opponentAnimationFrame);
            opponentAnimationFrame = requestAnimationFrame(animateOpponent);

            // Time mode already over on the shared clock — finish immediately.
            var endAt = racePayloadEndsAt(payload);
            if (config.mode === 'time' && endAt && Date.now() >= endAt) {
                state = 'waiting-result';
                localFinished = true;
                localFinishTime = endAt;
                bindRaceKeys();
                clearInterval(updateTimer);
                stopCursorSync();
                if (isLocalBotMatch()) {
                    finishLocalBotRace('time');
                    return;
                }
                sendThreeWordPacket(true);
                showMessage('Finished', 'Calculating race results.');
                return;
            }

            function unlockTyping() {
                if (token !== raceStartToken) return;
                state = 'racing';
                resetZenState();
                hideMessage();
                opponentDisplayWpm = 0;
                if (window.usertypo_settingsApi) {
                    applyDualTestSettings();
                } else {
                    bindDualKeymapRenderArgs();
                }
                updateLineLayout();
                showTestChrome();
                if (caret) caret.classList.remove('animate-breath');
                bindRaceKeys();
                clearInterval(updateTimer);
                updateTimer = setInterval(updateLiveStats, 200);
                updateLiveStats();
                if (isLocalBotMatch()) startLocalBotTimer();
                else startCursorSync();
                updateCaret();
            }

            var wait = Math.max(0, startTime - Date.now());
            if (wait <= 0) unlockTyping();
            else setTimeout(unlockTyping, wait);
        }

        function updateConfigUi() {
            /* Config pill removed from dual test view. */
        }

        function paintDualOpponentAvatar(opponent) {
            opponentAvatar = document.getElementById('bot-avatar');
            if (!opponentAvatar) return;
            if (window.usertypoPlayerAvatar && opponent) {
                opponentAvatar.outerHTML = window.usertypoPlayerAvatar.fromPlayer({
                    name: opponent.name,
                    avatarUrl: opponent.avatarUrl,
                    level: opponent.level,
                    percentToNext: opponent.percentToNext,
                    isBot: !!(bot && (!opponent || opponent.userId === 'bot')),
                }, {
                    size: 'xs',
                    id: 'bot-avatar',
                    showLevel: !(bot && (!opponent || opponent.userId === 'bot')),
                });
                opponentAvatar = document.getElementById('bot-avatar');
            } else if (opponent && opponent.avatarUrl) {
                opponentAvatar.style.backgroundImage = "url('" + String(opponent.avatarUrl).replace(/'/g, '%27') + "')";
            }
        }

        function paintOpponentCaret(wordIndex, charIndex) {
            if (!opponentCaret || !words.length || !textContainer) return;
            var safeWordIndex = Math.min(
                Math.max(0, wordIndex),
                Math.max(0, words.length - 1)
            );
            var safeCharIndex = Math.max(0, Math.floor(Number(charIndex) || 0));
            var promptLen = (words[safeWordIndex] || '').length;
            var extraCount = Math.max(0, safeCharIndex - promptLen);
            var wordElement = document.getElementById('word-' + safeWordIndex);
            var caretStyle = (document.body && document.body.getAttribute('data-caret-style')) || 'underscore';
            var charWidth = estimateOpponentCharWidth(wordElement, safeWordIndex);

            opponentCaret.style.display = 'block';

            // Never inject extra letters into the local prompt — only grow the caret.
            if (extraCount > 0) {
                var isRtl = typeof window.isTypingRTL === 'function' ? window.isTypingRTL() : false;
                var layoutIndex = promptLen;
                var resolved = typeof window.resolveCaretCharTarget === 'function'
                    ? window.resolveCaretCharTarget(wordElement, safeWordIndex, layoutIndex, 'char')
                    : null;
                if (resolved && typeof window.getCaretLayoutInContainer === 'function') {
                    var box = window.getCaretLayoutInContainer(
                        textContainer, wordElement, resolved.target, resolved.isAfter, isRtl
                    );
                    var width = opponentCaretWidth(caretStyle, charWidth, charWidth, extraCount);
                    opponentCaret.classList.add('opponent-caret-expanded');
                    opponentCaret.style.transform = 'translate3d(' + box.left + 'px,' + box.top + 'px,0)';
                    opponentCaret.style.setProperty('width', width + 'px', 'important');
                }
            } else {
                opponentCaret.classList.remove('opponent-caret-expanded');
                positionCaretAt(opponentCaret, safeWordIndex, safeCharIndex);
                if (caretStyle === 'line') {
                    opponentCaret.style.setProperty('width', '2.5px', 'important');
                }
            }

            opponentOffset = wordOffset(safeWordIndex) + safeCharIndex;
            opponentDisplayWordIndex = safeWordIndex;
            opponentDisplayCharIndex = safeCharIndex;
            opponentDisplayOffset = opponentOffset;
        }

        function resetOpponentCaretInstant() {
            opponentTargetWordIndex = 0;
            opponentTargetCharIndex = 0;
            opponentTargetOffset = 0;
            opponentDisplayWordIndex = 0;
            opponentDisplayCharIndex = 0;
            opponentDisplayOffset = 0;
            opponentOffset = 0;
            opponentTargetWpm = 0;
            opponentHasReport = false;
            opponentDisplayWpm = 0;
            lastOpponentCursorAt = 0;
            if (!opponentCaret || !words.length) return;
            opponentCaret.classList.remove('opponent-caret-expanded');
            opponentCaret.style.transition = 'none';
            opponentCaret.style.display = 'block';
            paintOpponentCaret(0, 0);
            void opponentCaret.offsetHeight;
            opponentCaret.style.transition = '';
        }

        function applyOpponentCursor(payload) {
            if (!Array.isArray(payload) || Number(payload[0]) !== Number(opponentIndex)) return;
            setOpponentTarget(
                Math.max(0, Number(payload[2]) || 0),
                Math.max(0, Number(payload[3]) || 0),
                Number(payload[1]) || 0
            );
            lastOpponentCursorAt = Date.now();
            snapOpponentDisplayPosition();
        }

        function applyOpponentProgress(payload) {
            if (!Array.isArray(payload) || Number(payload[0]) !== Number(opponentIndex)) return;
            if (isLocalBotMatch()) return;

            var wpm = Math.max(0, Number(payload[1]) || 0);
            var completedWords = Number(payload[4]) || 0;
            var position = positionFromCompletedWords(completedWords);

            if (isBotMatch()) {
                setOpponentTarget(position.wordIndex, position.charIndex, wpm);
                snapOpponentDisplayPosition();
                return;
            }

            // PvP: progress updates opponent WPM only — cursor packets own position.
            opponentTargetWpm = wpm;
            opponentHasReport = true;
        }

        function fillCard(prefix, data) {
            function set(id, value) {
                var element = document.getElementById(id);
                if (element) element.textContent = value;
            }
            var nameEl = document.getElementById(prefix + '-name');
            if (nameEl) nameEl.textContent = data.name || '—';
            var youEl = document.getElementById(prefix + '-you');
            if (youEl) {
                var isYou = !!(data.userId && data.userId === selfUserId);
                youEl.classList.toggle('hidden', !isYou);
            }
            var placeEl = document.getElementById(prefix + '-place');
            if (placeEl) {
                placeEl.textContent = prefix === 'w' ? '1st' : '2nd';
            }
            var avatar = document.getElementById(prefix + '-avatar');
            if (avatar) {
                if (window.usertypoPlayerAvatar) {
                    var html = window.usertypoPlayerAvatar.fromPlayer({
                        name: data.name,
                        avatarUrl: data.avatarUrl,
                        level: data.level,
                        percentToNext: data.percentToNext,
                        isBot: !!data.isBot,
                        userId: data.userId || data.user_id || '',
                    }, {
                        size: 'xl',
                        id: prefix + '-avatar',
                        className: prefix === 'w'
                            ? 'shadow-[0_0_16px_rgba(0,208,255,0.3)]'
                            : '',
                    });
                    if (avatar.classList && avatar.classList.contains('player-level-avatar')) {
                        avatar.outerHTML = html;
                    } else {
                        avatar.innerHTML = html;
                        var nested = avatar.firstElementChild;
                        if (nested) nested.id = prefix + '-avatar';
                        avatar.removeAttribute('id');
                    }
                } else {
                    avatar.textContent = data.name ? data.name.charAt(0).toUpperCase() : '?';
                    if (data.avatarUrl) {
                        avatar.textContent = '';
                        avatar.style.backgroundImage = "url('" + String(data.avatarUrl).replace(/'/g, '%27') + "')";
                        avatar.style.backgroundSize = 'cover';
                    }
                }
            }
            set(prefix + '-wpm', data.wpm);
            set(prefix + '-acc', data.accuracy);
            set(prefix + '-cons', data.consistency);
        }

        function truncatePillLabel(name) {
            var text = String(name || 'Player');
            if (text.length <= 12) return text;
            return text.slice(0, 11) + '…';
        }

        function pillLabelForPlayer(data) {
            var name = truncatePillLabel(data && data.name ? data.name : 'Player');
            if (data && data.userId && String(data.userId) === String(selfUserId)) {
                return name + ' (you)';
            }
            return name;
        }

        function updateDualGraphPillIndicator(activeBtn) {
            var indicator = document.getElementById('dual-graph-pill-indicator');
            var pill = document.getElementById('dual-graph-player-pill');
            if (!indicator || !pill || !activeBtn) return;
            var pillRect = pill.getBoundingClientRect();
            var btnRect = activeBtn.getBoundingClientRect();
            indicator.style.left = (btnRect.left - pillRect.left) + 'px';
            indicator.style.width = btnRect.width + 'px';
        }

        function bindDualGraphPill() {
            if (graphPillBound) return;
            graphPillBound = true;
            var winnerBtn = document.getElementById('dual-graph-btn-winner');
            var secondBtn = document.getElementById('dual-graph-btn-second');
            function selectSide(side) {
                graphSelectedSide = side === 'l' ? 'l' : 'w';
                if (winnerBtn) winnerBtn.classList.toggle('active', graphSelectedSide === 'w');
                if (secondBtn) secondBtn.classList.toggle('active', graphSelectedSide === 'l');
                updateDualGraphPillIndicator(graphSelectedSide === 'w' ? winnerBtn : secondBtn);
                renderDualBasicGraph(true);
            }
            if (winnerBtn) {
                winnerBtn.addEventListener('click', function () { selectSide('w'); });
            }
            if (secondBtn) {
                secondBtn.addEventListener('click', function () { selectSide('l'); });
            }
            if (!graphResizeBound) {
                graphResizeBound = true;
                var resizeTimer = null;
                function onGraphLayoutChange() {
                    if (!statsView || statsView.classList.contains('hidden')) return;
                    if (resizeTimer) clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(function () {
                        var active = document.querySelector('#dual-graph-player-pill button.active');
                        updateDualGraphPillIndicator(active);
                        renderDualBasicGraph(true);
                    }, 80);
                }
                window.addEventListener('resize', onGraphLayoutChange, { signal: signal });
                var graphCard = document.getElementById('dual-stats-graph-card');
                if (graphCard && typeof ResizeObserver === 'function') {
                    var ro = new ResizeObserver(onGraphLayoutChange);
                    ro.observe(graphCard);
                    signal.addEventListener('abort', function () {
                        try { ro.disconnect(); } catch (_) { /* ignore */ }
                    });
                }
            }
        }

        function dualFormatGraphTime(seconds) {
            if (Math.abs(seconds - Math.round(seconds)) < 0.0005) return Math.round(seconds) + 's';
            return String(seconds.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')) + 's';
        }

        function dualBuildGraphTimeLabels(maxX, xOfTime, height) {
            var values = [0];
            var step = Math.max(1, Math.floor(maxX / 6));
            for (var second = step; second < maxX; second += step) values.push(second);
            if (maxX > 0) {
                if (values.length > 1 && maxX - values[values.length - 1] < step * 0.6) values.pop();
                values.push(maxX);
            }
            return values.map(function (second, index) {
                var anchor = index === 0 ? 'start' : (index === values.length - 1 ? 'end' : 'middle');
                return '<text x="' + xOfTime(second).toFixed(1) + '" y="' + (height - 8).toFixed(1)
                    + '" fill="#64748b" font-size="11" text-anchor="' + anchor
                    + '" font-family="monospace">' + dualFormatGraphTime(second) + '</text>';
            }).join('');
        }

        function dualAnimateGraphLineReveal(path, clipRect, graphWidth, padLeft, options) {
            if (!path) return null;
            options = options || {};
            var duration = options.duration != null ? options.duration : 1200;
            var delay = options.delay != null ? options.delay : 0;
            var length = path.getTotalLength();
            path.style.strokeDasharray = String(length);
            path.style.strokeDashoffset = String(length);
            if (clipRect) clipRect.setAttribute('width', '0');
            var animation = path.animate(
                [{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }],
                {
                    duration: duration,
                    delay: delay,
                    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
                    fill: 'both',
                }
            );
            function syncGradient() {
                if (!path.isConnected) return;
                var timing = animation.effect.getComputedTiming();
                var progress = Number.isFinite(timing.progress) ? timing.progress : 0;
                if (clipRect) {
                    var point = path.getPointAtLength(Math.max(0, Math.min(length, progress * length)));
                    clipRect.setAttribute('width', String(Math.max(0, point.x - padLeft)));
                }
                if (animation.playState === 'finished') {
                    path.style.strokeDasharray = 'none';
                    path.style.strokeDashoffset = '0';
                    if (clipRect) clipRect.setAttribute('width', String(graphWidth));
                    return;
                }
                requestAnimationFrame(syncGradient);
            }
            requestAnimationFrame(syncGradient);
            return animation;
        }

        function renderDualBasicGraph(isUpdate) {
            var container = document.getElementById('dual-graph-container');
            var tooltip = document.getElementById('dual-graph-tooltip');
            var legend = document.getElementById('dual-graph-legend');
            if (!container) return;
            var series = graphSeriesBySide[graphSelectedSide] || graphSeriesBySide.w;
            var old = container.querySelector('svg.dynamic-graph');
            if (old) old.remove();
            if (tooltip) tooltip.style.display = 'none';
            if (!series || !series.wpmHistory || !series.wpmHistory.length) {
                if (legend) legend.style.opacity = '0';
                return;
            }
            var wBase = series.wpmHistory.slice();
            var rBase = (series.rawHistory && series.rawHistory.length)
                ? series.rawHistory.slice()
                : wBase.slice();
            while (rBase.length < wBase.length) rBase.push(rBase[rBase.length - 1] || 0);
            if (rBase.length > wBase.length) rBase.length = wBase.length;

            var testDurationSec = startTime && localFinishTime
                ? (localFinishTime - startTime) / 1000
                : wBase.length;
            var maxX = Math.max(wBase.length, testDurationSec, 0.001);
            var times = [0];
            for (var i = 0; i < wBase.length; i += 1) times.push(i + 1);
            var startFromZero = !!(window.usertypo_settings || {}).resultsAndGraphs?.startGraphFromZero;
            var wData = [startFromZero ? 0 : wBase[0]].concat(wBase);
            var rData = [startFromZero ? 0 : rBase[0]].concat(rBase);
            if (maxX > wBase.length) {
                times.push(maxX);
                wData.push(wBase[wBase.length - 1]);
                rData.push(rBase[rBase.length - 1]);
            }
            var n = wData.length;

            var W = Math.max(280, container.clientWidth || 0);
            var H = Math.max(140, container.clientHeight || 0);
            var PAD = { top: 16, right: 20, bottom: 32, left: 42 };
            var gW = W - PAD.left - PAD.right;
            var gH = H - PAD.top - PAD.bottom;
            var rawMax = Math.max.apply(null, wData.concat(rData).concat([10])) * 1.05;
            var yMax = Math.ceil(rawMax / 30) * 30;
            var yStep = yMax / 3;
            var smoothLines = (window.usertypo_settings || {}).resultsAndGraphs?.smoothGraphLines !== false;
            var minVal = 0;
            var xOfTime = function (second) { return PAD.left + (second / maxX) * gW; };
            var xOfIndex = function (idx) { return xOfTime(times[idx]); };
            var yOf = function (v) { return PAD.top + gH - ((v - minVal) / (yMax - minVal)) * gH; };

            function smoothPath(arr) {
                if (arr.length < 2) return '';
                var pts = arr.map(function (v, idx) { return { x: xOfIndex(idx), y: yOf(v) }; });
                var d = 'M ' + pts[0].x.toFixed(2) + ',' + pts[0].y.toFixed(2);
                if (!smoothLines) {
                    for (var j = 1; j < pts.length; j += 1) {
                        d += ' L ' + pts[j].x.toFixed(2) + ',' + pts[j].y.toFixed(2);
                    }
                    return d;
                }
                for (var k = 0; k < pts.length - 1; k += 1) {
                    var cp1x = pts[k].x + (pts[k + 1].x - (k > 0 ? pts[k - 1].x : pts[k].x)) / 6;
                    var cp1y = pts[k].y + (pts[k + 1].y - (k > 0 ? pts[k - 1].y : pts[k].y)) / 6;
                    var cp2x = pts[k + 1].x - (k + 2 < pts.length ? pts[k + 2].x - pts[k].x : pts[k + 1].x - pts[k].x) / 6;
                    var cp2y = pts[k + 1].y - (k + 2 < pts.length ? pts[k + 2].y - pts[k].y : pts[k + 1].y - pts[k].y) / 6;
                    d += ' C ' + cp1x.toFixed(2) + ',' + cp1y.toFixed(2) + ' '
                        + cp2x.toFixed(2) + ',' + cp2y.toFixed(2) + ' '
                        + pts[k + 1].x.toFixed(2) + ',' + pts[k + 1].y.toFixed(2);
                }
                return d;
            }

            function smoothFillPath(arr) {
                var lp = smoothPath(arr);
                if (!lp) return '';
                return lp + ' L ' + xOfIndex(arr.length - 1).toFixed(2) + ',' + (PAD.top + gH).toFixed(2)
                    + ' L ' + xOfIndex(0).toFixed(2) + ',' + (PAD.top + gH).toFixed(2) + ' Z';
            }

            var gridLinesArr = [];
            for (var v = 0; v <= yMax; v += yStep) {
                var yy = yOf(v);
                gridLinesArr.push(
                    '<line x1="' + PAD.left + '" y1="' + yy.toFixed(1) + '" x2="' + (PAD.left + gW).toFixed(1)
                    + '" y2="' + yy.toFixed(1) + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>'
                    + '<text x="' + (PAD.left - 8).toFixed(1) + '" y="' + (yy + 4).toFixed(1)
                    + '" fill="#64748b" font-size="11" text-anchor="end" font-family="monospace">' + v + '</text>'
                );
            }

            var gradId = 'dualWpmFillGrad';
            var clipId = 'dualFillReveal';
            var playAnim = !isUpdate && !graphAnimationPlayed;
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'dynamic-graph');
            svg.setAttribute('width', String(W));
            svg.setAttribute('height', String(H));
            svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
            svg.style.cssText = 'position:absolute;inset:0;overflow:visible;cursor:default;';
            svg.innerHTML = [
                '<defs>',
                '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">',
                '<stop offset="0%" stop-color="var(--theme-primary, #00d0ff)" stop-opacity="0.22"/>',
                '<stop offset="100%" stop-color="var(--theme-primary, #00d0ff)" stop-opacity="0"/>',
                '</linearGradient>',
                '<clipPath id="' + clipId + '">',
                '<rect id="dualFillRevealRect" x="' + PAD.left + '" y="' + PAD.top + '" width="'
                    + (playAnim ? 0 : gW) + '" height="' + (gH + 2) + '"/>',
                '</clipPath>',
                '</defs>',
                gridLinesArr.join(''),
                dualBuildGraphTimeLabels(maxX, xOfTime, H),
                '<path d="' + smoothFillPath(wData) + '" fill="url(#' + gradId + ')" clip-path="url(#' + clipId + ')"/>',
                '<path id="dual-raw-line" d="' + smoothPath(rData) + '" fill="none" stroke="#64748b" stroke-width="2.5"',
                ' stroke-dasharray="6 4" opacity="0.65" stroke-linecap="round"/>',
                '<path id="dual-wpm-line" d="' + smoothPath(wData) + '" fill="none" stroke="var(--theme-primary, #00d0ff)"',
                ' stroke-width="3" stroke-linecap="round" stroke-linejoin="round"',
                ' style="filter: drop-shadow(0 0 4px rgba(var(--theme-primary-rgb), var(--gi-55, 0.55)));"/>',
                '<line id="dual-graph-scrubber" x1="0" y1="' + PAD.top + '" x2="0" y2="' + (PAD.top + gH)
                    + '" stroke="rgba(255,255,255,0.18)" stroke-width="1" stroke-dasharray="3 2" style="display:none;"/>',
                '<circle id="dual-ball-wpm" r="5" fill="var(--theme-primary, #00d0ff)"',
                ' style="display:none;filter: drop-shadow(0 0 5px rgba(var(--theme-primary-rgb), var(--gi-90, 0.9)));"/>',
                '<circle id="dual-ball-raw" r="4" fill="#64748b" opacity="0.85" style="display:none;"/>',
                '<rect id="dual-graph-hit" x="' + PAD.left + '" y="' + PAD.top + '" width="' + gW
                    + '" height="' + gH + '" fill="transparent"/>',
            ].join('');
            container.appendChild(svg);

            var fillRevealRect = svg.querySelector('#dualFillRevealRect');
            var wpmLineEl = svg.querySelector('#dual-wpm-line');
            var rawLineEl = svg.querySelector('#dual-raw-line');
            var actualWLen = wpmLineEl ? wpmLineEl.getTotalLength() : 0;
            var actualRLen = rawLineEl ? rawLineEl.getTotalLength() : 0;
            if (playAnim) {
                dualAnimateGraphLineReveal(wpmLineEl, fillRevealRect, gW, PAD.left, {
                    duration: 1200,
                    delay: 300,
                });
                if (rawLineEl) {
                    rawLineEl.animate(
                        [{ opacity: 0 }, { opacity: 0.65 }],
                        { duration: 800, delay: 450, easing: 'ease', fill: 'both' }
                    );
                }
                graphAnimationPlayed = true;
            } else if (wpmLineEl) {
                wpmLineEl.style.strokeDasharray = 'none';
                wpmLineEl.style.strokeDashoffset = '0';
                if (rawLineEl) rawLineEl.style.opacity = '0.65';
            }

            function getYForX(pathElem, targetX, totalLen) {
                var low = 0;
                var high = totalLen;
                for (var iter = 0; iter < 15; iter += 1) {
                    var mid = (low + high) / 2;
                    var pt = pathElem.getPointAtLength(mid);
                    if (pt.x > targetX) high = mid;
                    else low = mid;
                }
                return pathElem.getPointAtLength((low + high) / 2).y;
            }

            var scrubber = svg.querySelector('#dual-graph-scrubber');
            var hitRect = svg.querySelector('#dual-graph-hit');
            var ballWpm = svg.querySelector('#dual-ball-wpm');
            var ballRaw = svg.querySelector('#dual-ball-raw');
            if (hitRect) {
                hitRect.addEventListener('mousemove', function (e) {
                    var rect = svg.getBoundingClientRect();
                    var relX = Math.max(0, Math.min(gW, e.clientX - rect.left - PAD.left));
                    var frac = relX / gW;
                    var cx = PAD.left + relX;
                    scrubber.setAttribute('x1', cx.toFixed(2));
                    scrubber.setAttribute('x2', cx.toFixed(2));
                    scrubber.style.display = 'block';
                    var wy = getYForX(wpmLineEl, cx, actualWLen);
                    var ry = getYForX(rawLineEl, cx, actualRLen);
                    ballWpm.setAttribute('cx', cx.toFixed(2));
                    ballWpm.setAttribute('cy', wy.toFixed(2));
                    ballWpm.style.display = 'block';
                    ballRaw.setAttribute('cx', cx.toFixed(2));
                    ballRaw.setAttribute('cy', ry.toFixed(2));
                    ballRaw.style.display = 'block';
                    var cursorSec = frac * maxX;
                    var index = 0;
                    while (index < times.length - 1 && times[index + 1] <= cursorSec) index += 1;
                    var nextIndex = Math.min(index + 1, n - 1);
                    var interval = times[nextIndex] - times[index];
                    var t = interval > 0 ? (cursorSec - times[index]) / interval : 0;
                    var wv = Math.round(wData[index] * (1 - t) + wData[nextIndex] * t);
                    var rv = Math.round(rData[index] * (1 - t) + rData[nextIndex] * t);
                    if (tooltip) {
                        tooltip.innerHTML =
                            '<div style="color:#94a3b8;margin-bottom:1px;">' + dualFormatGraphTime(cursorSec) + '</div>'
                            + '<div style="color:var(--theme-primary, #00d0ff);">' + wv
                            + ' <span style="font-weight:400;font-size:0.48rem;">wpm</span></div>'
                            + '<div style="color:#64748b;">' + rv
                            + ' <span style="font-weight:400;font-size:0.48rem;">raw</span></div>';
                        var tipW = 80;
                        var tx = cx + 15;
                        if (tx + tipW > W) tx = cx - tipW - 15;
                        tooltip.style.left = tx + 'px';
                        tooltip.style.top = wy + 'px';
                        tooltip.style.transform = wy > H / 2 ? 'translateY(-100%)' : 'translateY(0)';
                        tooltip.style.display = 'block';
                    }
                });
                hitRect.addEventListener('mouseleave', function () {
                    scrubber.style.display = 'none';
                    ballWpm.style.display = 'none';
                    ballRaw.style.display = 'none';
                    if (tooltip) tooltip.style.display = 'none';
                });
            }
            if (legend) {
                legend.style.opacity = '1';
            }
        }

        function setupDualResultsGraph(winnerData, loserData, meWon, endTime) {
            var selfSeries = finalizeSelfGraphHistory(endTime, meWon ? winnerData.wpm : loserData.wpm, meWon ? winnerData.raw : loserData.raw);
            var oppSeries = finalizeOpponentGraphHistory(endTime, meWon ? loserData.wpm : winnerData.wpm, meWon ? loserData.raw : winnerData.raw);
            graphSeriesBySide = {
                w: meWon ? selfSeries : oppSeries,
                l: meWon ? oppSeries : selfSeries,
            };
            graphSelectedSide = 'w';
            graphAnimationPlayed = false;
            var winnerBtn = document.getElementById('dual-graph-btn-winner');
            var secondBtn = document.getElementById('dual-graph-btn-second');
            if (winnerBtn) {
                winnerBtn.textContent = pillLabelForPlayer(winnerData);
                winnerBtn.classList.add('active');
            }
            if (secondBtn) {
                secondBtn.textContent = pillLabelForPlayer(loserData);
                secondBtn.classList.remove('active');
            }
            bindDualGraphPill();
            function paintGraph() {
                updateDualGraphPillIndicator(winnerBtn);
                renderDualBasicGraph(false);
            }
            requestAnimationFrame(function () {
                requestAnimationFrame(paintGraph);
            });
            setTimeout(paintGraph, 120);
        }

        function findResultRow(rows, userId, index) {
            var byUser = rows.find(function (row) {
                return String(row[1]) === String(userId);
            });
            if (byUser) return byUser;
            return rows.find(function (row) { return row[0] === index; }) || [];
        }

        function resolveMyResultRow(rows) {
            var candidates = [];
            var ready = window.usertypoMultiplayer && window.usertypoMultiplayer.getReadyState();
            if (ready && ready.userId) candidates.push(String(ready.userId));
            if (window.usertypoAuth && typeof window.usertypoAuth.getState === 'function') {
                var auth = window.usertypoAuth.getState();
                if (auth && auth.user && auth.user.id) candidates.push(String(auth.user.id));
            }
            candidates.push(String(getLocalUserId()));
            if (players[selfIndex] && players[selfIndex].userId) {
                candidates.push(String(players[selfIndex].userId));
            }
            var seen = {};
            for (var i = 0; i < candidates.length; i += 1) {
                var candidate = candidates[i];
                if (!candidate || seen[candidate]) continue;
                seen[candidate] = true;
                var hit = rows.find(function (row) { return String(row[1]) === candidate; });
                if (hit) {
                    selfUserId = String(hit[1]);
                    selfIndex = hit[0];
                    return hit;
                }
            }
            return findResultRow(rows, selfUserId, selfIndex);
        }

        function resolveOtherResultRow(rows, myRow, otherUserId, otherIdx) {
            if (myRow && myRow.length) {
                var byIndex = rows.find(function (row) { return row[0] !== myRow[0]; });
                if (byIndex) return byIndex;
            }
            return findResultRow(rows, otherUserId, otherIdx);
        }

        function resultsRowsKey(payload) {
            var rows = Array.isArray(payload) ? (payload[2] || []) : [];
            return JSON.stringify(rows);
        }

        function showResults(payload) {
            var payloadRoom = Array.isArray(payload) ? String(payload[0] || '') : '';
            if (!Array.isArray(payload) || payloadRoom !== String(roomId || '')) return;
            var rows = payload[2] || [];
            var alreadyFinished = state === 'finished' && latestResults;
            if (alreadyFinished && resultsRowsKey(payload) === resultsRowsKey(latestResults)) {
                testView.classList.add('hidden');
                testView.style.display = 'none';
                statsView.classList.remove('hidden', 'opacity-0');
                statsView.classList.add('flex');
                statsView.style.display = 'flex';
                setDualFooterMode('stats-full');
                setDualHeaderInteractive(true);
                return;
            }
            var firstPaint = !alreadyFinished;
            state = 'finished';
            latestResults = payload;
            if (firstPaint) {
                clearInterval(updateTimer);
                if (opponentAnimationFrame) cancelAnimationFrame(opponentAnimationFrame);
                opponentAnimationFrame = null;
            }
            var me = players.find(function (player) { return player.userId === selfUserId; }) || { name: 'You', avatarUrl: '' };
            var other = players.find(function (player) { return player.userId !== selfUserId; })
                || { name: bot && bot.name || 'Opponent', avatarUrl: '' };
            var paintResults = function () {
                var meRow = resolveMyResultRow(rows);
                var otherRow = resolveOtherResultRow(rows, meRow, other.userId, opponentIndex);
                var mePlayer = players.find(function (player) { return String(player.userId) === String(meRow[1]); });
                var otherPlayer = players.find(function (player) { return String(player.userId) === String(otherRow[1]); });
                if (mePlayer) me = mePlayer;
                if (otherPlayer) other = otherPlayer;
                var serverMe = parseServerResult(meRow);
                var serverOther = parseServerResult(otherRow);
                var localMe = computeFinalStats(localFinishTime || Date.now());
                var meData;
                var otherData;
                if (isBotMatch()) {
                    meData = (serverMe && serverMe.wpm > 0)
                        ? Object.assign({}, serverMe)
                        : Object.assign({}, localMe || serverMe || { wpm: 0, raw: 0, accuracy: 100, consistency: 100, correct: 0, total: 0, errors: 0, extra: 0, time: 0 });
                    otherData = serverOther || {
                        name: other.name,
                        avatarUrl: other.avatarUrl,
                        level: other.level,
                        percentToNext: other.percentToNext,
                        wpm: 0,
                        accuracy: 0,
                        time: config && config.mode === 'time' ? config.amount : 0,
                        consistency: 0,
                        raw: 0,
                        errors: 0,
                        correct: 0,
                        total: 0,
                        extra: 0,
                    };
                } else {
                    meData = serverMe
                        ? Object.assign({}, serverMe)
                        : Object.assign({}, localMe || { wpm: 0, raw: 0, accuracy: 100, consistency: 100, correct: 0, total: 0, errors: 0, extra: 0, time: 0 });
                    otherData = serverOther
                        ? Object.assign({}, serverOther)
                        : {
                            name: other.name,
                            avatarUrl: other.avatarUrl,
                            level: other.level,
                            percentToNext: other.percentToNext,
                            wpm: 0,
                            accuracy: 0,
                            time: config && config.mode === 'time' ? config.amount : 0,
                            consistency: 0,
                            raw: 0,
                            errors: 0,
                            correct: 0,
                            total: 0,
                            extra: 0,
                        };
                }
                meData.name = me.name;
                meData.avatarUrl = me.avatarUrl;
                meData.level = me.level;
                meData.percentToNext = me.percentToNext;
                otherData.name = other.name;
                otherData.avatarUrl = other.avatarUrl;
                otherData.level = other.level;
                otherData.percentToNext = other.percentToNext;
                otherData.userId = other.userId;
                otherData.isBot = !!(bot && other.userId === 'bot') || !!(other.isBot);
                meData.userId = me.userId;
                var meWon = meRow.length && rows.length && rows[0][0] === meRow[0];
                var winnerData = meWon ? meData : otherData;
                var loserData = meWon ? otherData : meData;
                fillCard('w', winnerData);
                fillCard('l', loserData);
                var endTime = localFinishTime || Date.now();
                setupDualResultsGraph(winnerData, loserData, meWon, endTime);
            };
            if (!firstPaint) {
                if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                    window.usertypoProgression.attachToList(players, 'userId').then(paintResults).catch(paintResults);
                } else {
                    paintResults();
                }
                return;
            }
            var label = document.getElementById('stats-race-label');
            if (label) label.textContent = 'Dual Race · ' + config.amount + ' ' + (config.mode === 'words' ? 'Words' : 'Seconds');
            if (payload[3]) opponentLeft = true;
            if (payload[3] || opponentLeft) {
                var capture = document.getElementById('stats-capture-area') || statsView;
                var existingNotice = capture.querySelector('[data-dual-opponent-left-notice]');
                if (existingNotice) existingNotice.remove();
                var notice = document.createElement('div');
                notice.setAttribute('data-dual-opponent-left-notice', '1');
                notice.className = 'mx-auto mb-4 px-4 py-2 rounded-full bg-error/10 border border-error/25 text-error text-sm font-semibold';
                notice.textContent = 'Your opponent left the dual mid-game.';
                capture.insertBefore(notice, capture.firstChild);
            }
            rematchVotes = 0;
            rematchNeeded = bot ? 1 : 2;
            selfRematchVoted = false;
            updateRematchButton();
            testView.classList.add('hidden');
            testView.style.display = 'none';
            statsView.classList.remove('hidden', 'opacity-0');
            statsView.classList.add('flex');
            statsView.style.display = 'flex';
            stopZenMode();
            setDualFooterMode('stats-full');
            setDualHeaderInteractive(true);
            initStatsHeader();
            if (typeof window.usertypo_unlockStatsScroll === 'function') {
                window.usertypo_unlockStatsScroll();
            }
            window.scrollTo(0, 0);
            // Retrigger enter animations (they may have completed while stats-view was hidden).
            statsView.querySelectorAll('.stats-animate-card').forEach(function (card) {
                card.style.animation = 'none';
                void card.offsetWidth;
                card.style.animation = '';
            });
            if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                window.usertypoProgression.attachToList(players, 'userId').then(paintResults).catch(paintResults);
            } else {
                paintResults();
            }
        }

        async function leaveDual() {
            if (!closingDual) closingDual = true;
            try {
                if (!isLocalBotMatch() && roomId && window.usertypoMultiplayer) {
                    await window.usertypoMultiplayer.leaveRace(roomId);
                }
            } catch (_) { /* ignore */ }
            if (typeof window.navigateTo === 'function') window.navigateTo('/multiplayer');
        }

        async function requestRematch() {
            if (state !== 'finished' || !config || selfRematchVoted) return;
            if (opponentLeft && !isBotMatch()) {
                window.usertypoNotifications?.showToast('Your opponent left — rematch is unavailable.', 'person_remove');
                return;
            }
            if (isLocalBotMatch()) {
                selfRematchVoted = true;
                rematchVotes = 1;
                updateRematchButton();
                try {
                    leaveStatsForRematch();
                    await restartLocalBotRace();
                } catch (error) {
                    selfRematchVoted = false;
                    rematchVotes = 0;
                    updateRematchButton();
                    window.usertypoNotifications?.showToast(error.message || 'Could not rematch', 'error');
                }
                return;
            }
            var button = document.getElementById('rematch-btn');
            if (button) button.disabled = true;
            try {
                await window.usertypoMultiplayer.requestRematch(roomId);
                selfRematchVoted = true;
                if (rematchVotes < 1) rematchVotes = 1;
                updateRematchButton();
            } catch (error) {
                if (button) button.disabled = false;
                window.usertypoNotifications?.showToast(error.message || 'Could not rematch', 'error');
            }
        }

        function bindResultActions() {
            var rematch = document.getElementById('rematch-btn');
            var leave = document.getElementById('leave-dual-btn');
            var screenshot = document.getElementById('screenshot-btn');
            if (rematch) rematch.addEventListener('click', requestRematch, { signal: signal });
            if (leave) leave.addEventListener('click', leaveDual, { signal: signal });
            if (screenshot) {
                screenshot.addEventListener('click', function () {
                    var captureArea = document.getElementById('stats-capture-area');
                    if (captureArea && window.StatsScreenshot) {
                        window.StatsScreenshot.capture({
                            captureArea: captureArea,
                            button: screenshot,
                            hideSelectors: ['#stats-action-buttons'],
                            padding: 56,
                        });
                    }
                }, { signal: signal });
            }
            document.addEventListener('keydown', function (event) {
                if (state !== 'finished') return;
                var tag = (event.target && event.target.tagName || '').toLowerCase();
                var inEditable = tag === 'input' || tag === 'textarea' || !!(event.target && event.target.isContentEditable);
                if (inEditable) return;

                if (event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault();
                    return;
                }

                var leaveBtn = document.getElementById('leave-dual-btn');
                if (event.key === 'Tab') {
                    if (window.usertypo_settingsApi?.areKeyboardShortcutsEnabled
                        && !window.usertypo_settingsApi.areKeyboardShortcutsEnabled()) {
                        return;
                    }
                    event.preventDefault();
                    leaveBtn?.focus();
                    return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                var active = document.activeElement;
                if (leaveBtn && (active === leaveBtn || leaveBtn.contains(active))) {
                    leaveDual();
                    return;
                }
                requestRematch();
            }, { signal: signal });
        }

        function bindEvents() {
            listen('race-countdown', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId) return;
                if (state === 'racing' || state === 'finished') return;
                if (!config) return;
                if (payload[2]) countdownEndsAtTarget = Number(payload[2]) || countdownEndsAtTarget;
                // Local 3→2→1 tape animation paced to countdownEndsAt.
                if (Number(payload[1]) === 0) return;
                ensureCountdownSequence();
            });
            listen('race-start', function (event) {
                if (state === 'finished') return;
                startRace(event.detail);
            });
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState !== 'visible') return;
                beginRaceIfAlreadyLive();
                if (state === 'racing') updateLiveStats();
            }, { signal: signal });
            listen('race-progress', function (event) { applyOpponentProgress(event.detail); });
            listen('race-cursor', function (event) { applyOpponentCursor(event.detail); });
            listen('race-player-left', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId || payload[1] === selfIndex) return;
                if (isBotMatch()) return;
                var reason = String(payload[2] || 'left');
                opponentLeft = true;

                // Stats view (or explicit stats leave): close dual immediately.
                if (state === 'finished' || reason === 'stats-left') {
                    updateRematchButton();
                    closeDualToFriends('Your opponent left the dual.', 'person_remove');
                    return;
                }

                // Waiting / countdown: auto-close — no race to finish.
                if (state === 'joining' || state === 'countdown') {
                    closeDualToFriends('Your opponent left the dual.', 'person_remove');
                    return;
                }

                // Mid-race / waiting-result: keep typing, notify, show banner on stats.
                updateRematchButton();
                if (window.usertypoNotifications) {
                    window.usertypoNotifications.showToast(
                        'Your opponent left. Finish the test normally.',
                        'person_remove'
                    );
                }
                if (state === 'waiting-result') {
                    showMessage('Finished', 'Opponent left. Calculating race results.');
                }
            });
            listen('race-finished', function (event) {
                var detail = event.detail;
                if (closingDual) return;
                // Pre-race opponent leave finishes the room — close instead of stats.
                if (
                    Array.isArray(detail)
                    && detail[0] === roomId
                    && detail[1] === 'opponent-left'
                    && state !== 'racing'
                    && state !== 'waiting-result'
                    && state !== 'finished'
                ) {
                    closeDualToFriends('Your opponent left the dual.', 'person_remove');
                    return;
                }
                // Bot matches may still receive a server finished after the local UI settled.
                if (isBotMatch() && state === 'finished') return;
                showResults(detail);
            });
            listen('race-rematch-state', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId) return;
                rematchVotes = Number(payload[1]) || 0;
                rematchNeeded = Math.max(1, Number(payload[2]) || 1);
                var agreedIds = payload[3] || [];
                if (selfUserId && agreedIds.indexOf(selfUserId) !== -1) selfRematchVoted = true;
                updateRematchButton();
            });
            listen('race-rematch-start', function (event) {
                var payload = event.detail || {};
                if (!payload.roomId || payload.roomId !== roomId) return;
                matchReason = payload.reason || matchReason;
                if (payload.config) {
                    applyDualRaceConfig(payload.config);
                    bindDualKeymapRenderArgs();
                }
                leaveStatsForRematch();
            });
            listen('match-resumed', function (event) {
                var response = event && event.detail || {};
                if (response.state === 'finished' && Array.isArray(response.results)) {
                    showResults([
                        roomId,
                        response.finishReason || 'complete',
                        response.results,
                        response.opponentLeft ? 1 : 0,
                        matchReason || (response.room && response.room.reason) || 'public',
                    ]);
                    return;
                }
                if (state === 'racing' || state === 'waiting-result') hideMessage();
            });
            listen('ready', function () {
                if (state === 'racing' || state === 'waiting-result') hideMessage();
            });
            listen('race-invalid', function () {
                state = 'finished';
                showMessage('Race invalid', 'The server rejected implausible progress.');
            });
            listen('disconnected', function () {
                // Avoid flashing "Connection lost" between rematches / brief socket blips.
                if (state === 'racing') {
                    showMessage('Connection lost', 'Trying to reconnect to the multiplayer server.');
                }
            });
        }

        async function init() {
            ensureDualKeymapHook();
            seedConfigFromPendingMatch();
            if (config) bindDualKeymapRenderArgs();
            setDualFooterMode('test-compact');
            setDualHeaderInteractive(false);
            wireZenHandlers();
            if (isLocalBotMatch()) {
                return initLocalBotRace();
            }
            if (!roomId || !window.usertypoMultiplayer) {
                if (typeof window.navigateTo === 'function') window.navigateTo('/multiplayer');
                return;
            }
            if (isReloadNavigation()) {
                redirectAfterRefresh();
                return;
            }
            bindEvents();
            bindResultActions();
            window.addEventListener('resize', function () {
                if (!words.length) return;
                if (state === 'countdown' || state === 'joining') {
                    syncCountdownLayout(!!document.getElementById('char-0-0')
                        && document.getElementById('char-0-0').style.opacity !== '0');
                    syncDualKeymapLayout();
                    return;
                }
                updateLineLayout();
                updateCaret();
                syncDualKeymapLayout();
            }, { signal: signal });
            try {
                var response = await window.usertypoMultiplayer.joinMatch(roomId);
                markDualMembership(true);
                setSessionFlag(refreshHandledKey, '');
                applyDualRaceConfig(response.room && response.room.config);
                if (response.race && response.race.config) {
                    applyDualRaceConfig(response.race.config);
                }
                if (response.race) pendingRacePayload = response.race;
                bindDualKeymapRenderArgs();
                players = response.room && response.room.players || [];
                bot = response.room && response.room.bot || null;
                matchReason = response.room && response.room.reason || '';
                selfUserId = window.usertypoMultiplayer.getReadyState()
                    && window.usertypoMultiplayer.getReadyState().userId || getLocalUserId();
                var joinedSelf = players.find(function (player) { return player.userId === selfUserId; });
                if (!joinedSelf && players.length === 2) {
                    var authId = getLocalUserId();
                    joinedSelf = players.find(function (player) { return player.userId === authId; }) || joinedSelf;
                }
                if (joinedSelf) selfUserId = joinedSelf.userId;
                var joinedOpponent = players.find(function (player) { return player.userId !== selfUserId; });
                selfIndex = joinedSelf ? joinedSelf.index : 0;
                opponentIndex = joinedOpponent ? joinedOpponent.index : (bot ? bot.index : 1);
                paintDualOpponentAvatar(joinedOpponent || null);
                if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                    window.usertypoProgression.attachToList(players, 'userId').then(function () {
                        joinedOpponent = players.find(function (player) { return player.userId !== selfUserId; });
                        paintDualOpponentAvatar(joinedOpponent || null);
                    }).catch(function () { /* ignore */ });
                }
                if (response.countdownEndsAt) {
                    countdownEndsAtTarget = Number(response.countdownEndsAt) || 0;
                }
                if (response.state === 'racing' && response.race) {
                    countdownSequenceStarted = true;
                    introBusy = false;
                    beginActualRace(response.race);
                    return;
                }
                if (response.state === 'countdown') {
                    prepareWaitingTestView();
                    ensureCountdownSequence();
                    return;
                }
                prepareWaitingTestView();
            } catch (error) {
                markDualMembership(false);
                showMessage('Could not join dual', error.message);
                setTimeout(function () {
                    if (typeof window.navigateTo === 'function') window.navigateTo('/multiplayer');
                }, 1800);
            }
        }

        function cleanup() {
            abortCountdownIntro();
            pendingRacePayload = null;
            countdownSequenceStarted = false;
            clearInterval(updateTimer);
            stopCursorSync();
            stopLocalBotTimer();
            if (opponentAnimationFrame) cancelAnimationFrame(opponentAnimationFrame);
            opponentAnimationFrame = null;
            // Always leave so dual membership cannot stick after navigating away.
            if (roomId && window.usertypoMultiplayer && !isLocalBotMatch()) {
                window.usertypoMultiplayer.leaveRace(roomId);
            }
            markDualMembership(false);
            abort.abort();
            if (window.updateKeymapHighlight === updateKeymapHighlight) {
                window.updateKeymapHighlight = null;
            }
            window.usertypo_getKeymapRenderArgs = null;
            if (window.applyDualLiveFeedSettings === applyDualLiveFeedSettings) {
                window.applyDualLiveFeedSettings = null;
            }
            latestResults = null;
        }

        window.applyDualLiveFeedSettings = applyDualLiveFeedSettings;

        return {
            init: init,
            cleanup: cleanup,
            refreshKeymap: bindDualKeymapRenderArgs,
            isActive: function () {
                return state === 'racing' || state === 'countdown' || state === 'waiting-result';
            },
            isTyping: function () { return state === 'racing'; },
        };
    }

    window.usertypoDualPage = {
        createController: createController,
    };
})();
