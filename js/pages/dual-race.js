/**
 * Multiplayer dual page controller.
 * The server owns room lifecycle/timing; this module owns local typing visuals only.
 */
(function () {
    'use strict';

    var initialDocumentPath = window.location.pathname;
    var refreshHandledKey = 'usertypo:dual-refresh-handled-room';

    function createController() {
        var abort = new AbortController();
        var signal = abort.signal;
        var params = new URLSearchParams(window.location.search);
        var roomId = params.get('room') || '';
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
        var localFinished = false;
        var latestResults = null;
        var lineHeight = 0;
        var opponentOffset = 0;
        var opponentDisplayWpm = 0;
        var opponentTargetWpm = 0;
        var opponentHasReport = false;
        var opponentFrameAt = 0;
        var opponentAnimationFrame = null;
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

        var testView = document.getElementById('test-view');
        var statsView = document.getElementById('stats-view');
        var typingArea = document.getElementById('typing-area');
        var textContainer = document.getElementById('text-container');
        var caret = document.getElementById('caret');
        var opponentCaret = document.getElementById('bot-caret');
        var wpmDisplay = document.getElementById('wpm-display');
        var accDisplay = document.getElementById('acc-display');
        var burstDisplay = document.getElementById('burst-display');
        var opponentWpmDisplay = document.getElementById('bot-wpm-display');
        var progressDisplay = document.getElementById('word-progress');
        var progressBar = document.getElementById('word-progress-bar');
        var opponentAvatar = document.getElementById('bot-avatar');
        var waitOverlay = null;

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
                    ? /[A-Z]/.test(expected)
                    : (pressedKey === 'Shift' && isKeyDown);
                keys.forEach(function (key) {
                    var text = key.querySelector('.keymap-main-text');
                    if (text && text.textContent.length === 1) {
                        text.textContent = uppercase ? text.textContent.toUpperCase() : text.textContent.toLowerCase();
                    }
                });
            }
            if (keyboard.keymapMode === 'Static') return;
            keys.forEach(function (key) {
                var chars = key.dataset.chars || '';
                var special = key.dataset.special || '';
                var matches = false;
                if (keyboard.keymapMode === 'Next') {
                    var next = words[currentWordIndex]?.[currentCharIndex] || ' ';
                    matches = chars.includes(next) || (next === ' ' && special === 'Space');
                } else if (pressedKey) {
                    matches = (pressedKey.length === 1 && chars.includes(pressedKey))
                        || (pressedKey === ' ' && special === 'Space')
                        || pressedKey === special;
                }
                key.classList.toggle('bg-primary/40', matches);
                key.classList.toggle('scale-95', matches);
                key.classList.toggle('ring-2', matches);
                key.classList.toggle('ring-primary/50', matches);
                key.classList.toggle('bg-primary/10', !matches);
            });
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

        function isReloadNavigation() {
            try {
                var entries = performance.getEntriesByType('navigation');
                var handledRoom = '';
                try { handledRoom = sessionStorage.getItem(refreshHandledKey) || ''; } catch (_) { /* ignore */ }
                return initialDocumentPath === '/dual'
                    && entries.length
                    && entries[0].type === 'reload'
                    && handledRoom !== roomId;
            } catch (_) {
                return false;
            }
        }

        function redirectAfterRefresh() {
            try { sessionStorage.setItem(refreshHandledKey, roomId); } catch (_) { /* ignore */ }
            if (window.usertypoNotifications) {
                window.usertypoNotifications.showToast('You left the dual because the page was refreshed.', 'cancel');
            }
            if (typeof window.navigateTo === 'function') window.navigateTo('/friends');
            else window.location.replace('/friends');
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
        }

        function applyTapeScroll() {
            var currentWord = document.getElementById('word-' + currentWordIndex);
            if (!currentWord || !typingArea.clientWidth) return;
            var center = typingArea.clientWidth / 2;
            var containerRect = textContainer.getBoundingClientRect();
            if (getTapeMode() === 'word') {
                var wordRect = currentWord.getBoundingClientRect();
                textContainer.style.transform = 'translateX(' + (center - (wordRect.left - containerRect.left) - wordRect.width / 2) + 'px)';
                return;
            }
            var target = document.getElementById('char-' + currentWordIndex + '-' + currentCharIndex);
            var after = false;
            if (!target) {
                target = document.getElementById('char-' + currentWordIndex + '-' + (currentCharIndex - 1));
                after = true;
            }
            if (!target) target = currentWord;
            var targetRect = target.getBoundingClientRect();
            var targetLeft = targetRect.left - containerRect.left + (after ? targetRect.width : 0);
            textContainer.style.transform = 'translateX(' + (center - targetLeft) + 'px)';
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
            var target = document.getElementById('char-' + wordIndex + '-' + charIndex);
            var after = false;
            if (!target) {
                target = document.getElementById('char-' + wordIndex + '-' + (charIndex - 1));
                after = true;
            }
            if (!target) target = wordElement;
            var targetRect = target.getBoundingClientRect();
            var containerRect = textContainer.getBoundingClientRect();
            element.style.display = 'block';
            var left = targetRect.left - containerRect.left + (after ? targetRect.width : 0);
            var top = targetRect.top - containerRect.top;
            element.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
            element.style.width = targetRect.width + 'px';
        }

        function updateCaret() {
            handleScroll();
            positionCaretAt(caret, currentWordIndex, currentCharIndex);
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
                // Never mirror the local player. No report / 0 WPM => ghost stays still.
                var desiredWpm = opponentHasReport ? Math.max(0, opponentTargetWpm) : 0;
                var blend = 1 - Math.exp(-elapsedSeconds * 3);
                opponentDisplayWpm += (desiredWpm - opponentDisplayWpm) * blend;
                if (desiredWpm <= 0 && opponentDisplayWpm < 0.5) opponentDisplayWpm = 0;
                if (opponentDisplayWpm > 0) {
                    opponentOffset += (opponentDisplayWpm * 5 / 60) * elapsedSeconds;
                }
                var last = Math.max(0, words.length - 1);
                var maxOffset = wordOffset(last) + (words[last] ? words[last].length : 0);
                opponentOffset = Math.max(0, Math.min(maxOffset, opponentOffset));
                var position = offsetToPosition(opponentOffset);
                positionCaretAt(opponentCaret, position.wordIndex, position.charIndex);
            }
            opponentAnimationFrame = requestAnimationFrame(animateOpponent);
        }

        function resetCharacter(wordIndex, charIndex) {
            var element = document.getElementById('char-' + wordIndex + '-' + charIndex);
            if (!element) return;
            if (element.classList.contains('extra')) {
                element.remove();
                extraChars = Math.max(0, extraChars - 1);
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
                element = document.createElement('span');
                element.id = 'char-' + wordIndex + '-' + charIndex;
                element.className = 'char extra transition-colors duration-75';
                wordElement.appendChild(element);
                extraChars += 1;
            }
            element.textContent = charIndex < words[wordIndex].length
                ? words[wordIndex][charIndex]
                : typed;
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

        function computeConsistencyFromTimes(times) {
            if (!Array.isArray(times) || times.length < 2) return 100;
            var intervals = [];
            for (var i = 1; i < times.length; i += 1) intervals.push(times[i] - times[i - 1]);
            if (intervals.length < 2) return 100;
            var mean = intervals.reduce(function (sum, value) { return sum + value; }, 0) / intervals.length;
            if (!mean) return 100;
            var variance = intervals.reduce(function (sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / intervals.length;
            var cov = Math.sqrt(variance) / mean;
            var kogasa = 100 * (1 - Math.tanh(cov + Math.pow(cov, 3) / 3 + Math.pow(cov, 5) / 5));
            return Math.max(0, Math.min(100, Math.round(kogasa)));
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
            return {
                wpm: Math.max(0, Math.round(exactWpm)),
                raw: Math.max(0, Math.round(exactRawWpm)),
                accuracy: Math.round(accuracy * 10) / 10,
                consistency: computeConsistencyFromTimes(keystrokeTimes),
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
            var name = profile.username || profile.display_name
                || (authState && authState.user && (authState.user.username || authState.user.fullName))
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
            var consistency = 100;
            if (keystrokeTimes.length > 2) {
                var intervals = [];
                for (var i = 1; i < keystrokeTimes.length; i += 1) intervals.push(keystrokeTimes[i] - keystrokeTimes[i - 1]);
                var mean = intervals.reduce(function (sum, value) { return sum + value; }, 0) / intervals.length;
                var variance = intervals.reduce(function (sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / intervals.length;
                consistency = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(1, Math.sqrt(variance) / Math.max(1, mean))))));
            }
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
            var stats = localStats();
            if (wpmDisplay) wpmDisplay.textContent = stats.wpm;
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
                progressDisplay.textContent = remaining;
                if (progressBar) {
                    var elapsed = Math.max(0, (Date.now() - startTime) / 1000);
                    progressBar.style.width = Math.min(100, (elapsed / config.amount) * 100) + '%';
                }
                if (remainingMs <= 0) {
                    localFinished = true;
                    localFinishTime = endAt;
                    state = 'waiting-result';
                    clearInterval(updateTimer);
                    sendThreeWordPacket(true);
                    showMessage('Finished', 'Calculating race results.');
                }
            } else {
                progressDisplay.innerHTML = completedCorrectWords + '<span class="text-slate-500">/</span>' + config.amount;
                if (progressBar) progressBar.style.width = Math.min(100, (completedCorrectWords / config.amount) * 100) + '%';
            }
        }

        function sendThreeWordPacket(forceFinal) {
            if (!window.usertypoMultiplayer || (state !== 'racing' && state !== 'waiting-result')) return;
            var shouldSend = (completedCorrectWords > 0 && completedCorrectWords % 3 === 0)
                || forceFinal === true;
            if (!shouldSend) return;
            var lastQueued = packetQueue.length ? packetQueue[packetQueue.length - 1] : null;
            if (!lastQueued || lastQueued.words !== completedCorrectWords || (forceFinal && !lastQueued.final)) {
                var finalStats = null;
                if (forceFinal === true) {
                    var snapshot = computeFinalStats(localFinishTime || Date.now());
                    finalStats = [snapshot.correct, snapshot.total, snapshot.errors, snapshot.extra, snapshot.time];
                }
                packetQueue.push({
                    words: completedCorrectWords,
                    keystrokes: totalKeystrokes,
                    final: forceFinal === true,
                    finalStats: finalStats,
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
            sendThreeWordPacket(finalWord);
            if (finalWord) {
                localFinished = true;
                localFinishTime = Date.now();
                state = 'waiting-result';
                showMessage('Finished', 'Waiting for your opponent to complete the test.');
                return;
            }
            updateCaret();
        }

        function handleBackspace(event) {
            event.preventDefault();
            if (unresolvedError && errorHistory.length) {
                var errorEntry = errorHistory.pop();
                if (errorEntry.kind === 'space') {
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
                if (currentCharIndex === word.length) {
                    correctKeystrokeTimes.push(Date.now());
                    completeWord();
                }
                else {
                    if (typeof window.playErrorSound === 'function') window.playErrorSound(key);
                    unresolvedError = { wordIndex: currentWordIndex, charIndex: currentCharIndex };
                    errorHistory = [{
                        kind: 'char',
                        wordIndex: currentWordIndex,
                        charIndex: currentCharIndex,
                    }];
                    paintCharacter(currentWordIndex, currentCharIndex, ' ', false, true);
                    currentCharIndex += 1;
                    errorsMade += 1;
                    updateCaret();
                }
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
            updateKeymapHighlight(event.key, true);
            if (event.key === 'Backspace') handleBackspace(event);
            else handlePrintable(event);
        }

        function bindRaceKeys() {
            if (raceKeysBound) return;
            raceKeysBound = true;
            document.addEventListener('keydown', onKeyDown, { signal: signal });
            document.addEventListener('keyup', function (event) {
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
            keystrokeTimes = [];
            correctKeystrokeTimes = [];
            unresolvedError = null;
            errorHistory = [];
            opponentLeft = false;
            localFinished = false;
            latestResults = null;
            opponentOffset = 0;
            opponentDisplayWpm = 0;
            opponentTargetWpm = 0;
            opponentHasReport = false;
            opponentFrameAt = 0;
            localFinishTime = 0;
            rematchVotes = 0;
            rematchNeeded = 2;
            selfRematchVoted = false;
            if (wpmDisplay) wpmDisplay.textContent = '0';
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
                button.disabled = !!selfRematchVoted;
                if (selfRematchVoted) button.setAttribute('aria-disabled', 'true');
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

        function racePayloadStartsAt(payload) {
            if (!payload) return Date.now();
            if (payload.startsAt) return Number(payload.startsAt);
            return Date.now() + Math.max(0, Number(payload.startsInMs) || 0);
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
            var showWpm = lf.liveWpm !== false;
            var showAcc = lf.liveAccuracy !== false;
            var showBurst = lf.liveBurst === true;
            var wpmWrapper = document.getElementById('live-wpm-wrapper');
            var accWrapper = document.getElementById('live-acc-wrapper');
            var burstWrapper = document.getElementById('live-burst-wrapper');
            var wpmDivider = document.getElementById('live-wpm-divider');
            var accDivider = document.getElementById('live-acc-divider');
            if (wpmWrapper) wpmWrapper.classList.toggle('hidden', !showWpm);
            if (accWrapper) accWrapper.classList.toggle('hidden', !showAcc);
            if (burstWrapper) burstWrapper.classList.toggle('hidden', !showBurst);
            if (wpmDivider) wpmDivider.classList.toggle('hidden', !(showWpm && showAcc));
            if (accDivider) accDivider.classList.toggle('hidden', !(showAcc && showBurst));
            if (showWpm && !showAcc && showBurst && wpmDivider) wpmDivider.classList.remove('hidden');

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
            if (window.usertypo_settingsApi) {
                try {
                    window.usertypo_settingsApi.applyAllSettings(window.usertypo_settingsApi.loadSettings());
                } catch (_) { /* defaults */ }
            }
            showTestChrome();
            requestAnimationFrame(function () {
                syncCountdownLayout(false);
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

        // Same fixed local 3→2→1 intro as rooms — race unlock still uses shared startsAt.
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
            ensureCountdownSequence();
            if (!introBusy) tryBeginRaceAfterIntro();
        }

        function beginActualRace(payload) {
            if (!payload || payload.roomId !== roomId) return;
            if (state === 'racing' || state === 'finished') return;
            raceStartToken += 1;
            var token = raceStartToken;
            config = payload.config;
            words = payload.words || [];
            window.usertypo_getKeymapRenderArgs = function () {
                return { useNumbers: !!config.nums, usePunctuation: !!config.punct };
            };
            window.updateKeymapHighlight = updateKeymapHighlight;
            players = payload.players || [];
            bot = payload.bot || null;
            // Always use the shared server clock — never reset when the tab becomes visible.
            startTime = racePayloadStartsAt(payload);
            selfUserId = window.usertypoMultiplayer.getReadyState()
                && window.usertypoMultiplayer.getReadyState().userId || '';
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
            keystrokeTimes = [];
            correctKeystrokeTimes = [];
            unresolvedError = null;
            errorHistory = [];
            localFinished = false;
            opponentOffset = 0;
            opponentDisplayWpm = 0;
            opponentTargetWpm = 0;
            opponentHasReport = false;
            opponentFrameAt = 0;
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
            if (opponentCaret) opponentCaret.style.display = 'block';
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
                sendThreeWordPacket(true);
                showMessage('Finished', 'Calculating race results.');
                return;
            }

            var wait = Math.max(0, startTime - Date.now());
            setTimeout(function () {
                if (token !== raceStartToken) return;
                state = 'racing';
                hideMessage();
                opponentDisplayWpm = 0;
                if (window.usertypo_settingsApi) {
                    try {
                        window.usertypo_settingsApi.applyAllSettings(window.usertypo_settingsApi.loadSettings());
                    } catch (_) { /* retain race defaults */ }
                }
                updateLineLayout();
                updateCaret();
                showTestChrome();
                if (caret) caret.classList.remove('animate-breath');
                bindRaceKeys();
                clearInterval(updateTimer);
                updateTimer = setInterval(updateLiveStats, 200);
                updateLiveStats();
            }, wait);
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

        function applyOpponentProgress(payload) {
            if (!Array.isArray(payload) || payload[0] !== opponentIndex) return;
            var nextWpm = Math.max(0, Number(payload[1]) || 0);
            opponentTargetWpm = nextWpm;
            opponentHasReport = true;
            if (opponentWpmDisplay) opponentWpmDisplay.textContent = Math.round(nextWpm);
        }

        function fillCard(prefix, data) {
            function set(id, value) {
                var element = document.getElementById(id);
                if (element) element.textContent = value;
            }
            set(prefix + '-name', data.name);
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
                        size: 'md',
                        id: prefix + '-avatar',
                        className: prefix === 'w'
                            ? 'shadow-[0_0_12px_rgba(0,208,255,0.25)]'
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
            set(prefix + '-time', data.time);
            set(prefix + '-acc', data.accuracy);
            set(prefix + '-cons', data.consistency);
            set(prefix + '-raw', data.raw);
            set(prefix + '-err', data.errors);
            set(prefix + '-correct', data.correct);
            set(prefix + '-total', data.total);
            set(prefix + '-extra', data.extra);
        }

        function showResults(payload) {
            var payloadRoom = Array.isArray(payload) ? String(payload[0] || '') : '';
            if (!Array.isArray(payload) || payloadRoom !== String(roomId || '')) return;
            if (state === 'finished' && latestResults) {
                // Idempotent — resume + live event may both arrive.
                testView.classList.add('hidden');
                testView.style.display = 'none';
                statsView.classList.remove('hidden', 'opacity-0');
                statsView.classList.add('flex');
                statsView.style.display = 'flex';
                return;
            }
            state = 'finished';
            latestResults = payload;
            clearInterval(updateTimer);
            if (opponentAnimationFrame) cancelAnimationFrame(opponentAnimationFrame);
            opponentAnimationFrame = null;
            var rows = payload[2] || [];
            var me = players.find(function (player) { return player.userId === selfUserId; }) || { name: 'You', avatarUrl: '' };
            var other = players.find(function (player) { return player.userId !== selfUserId; })
                || { name: bot && bot.name || 'Opponent', avatarUrl: '' };
            var paintResults = function () {
                var myRow = rows.find(function (row) { return row[0] === selfIndex; }) || [];
                var otherRow = rows.find(function (row) { return row[0] === opponentIndex; }) || [];
                var meData = parseServerResult(myRow) || computeFinalStats(localFinishTime || Date.now());
                meData.name = me.name;
                meData.avatarUrl = me.avatarUrl;
                meData.level = me.level;
                meData.percentToNext = me.percentToNext;
                var otherData = parseServerResult(otherRow) || {
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
            otherData.name = other.name;
            otherData.avatarUrl = other.avatarUrl;
            otherData.level = other.level;
            otherData.percentToNext = other.percentToNext;
            otherData.userId = other.userId;
            otherData.isBot = !!(bot && other.userId === 'bot') || !!(other.isBot);
            meData.userId = me.userId;
                var meWon = rows.length && rows[0][0] === selfIndex;
                fillCard('w', meWon ? meData : otherData);
                fillCard('l', meWon ? otherData : meData);
            };
            if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                window.usertypoProgression.attachToList(players, 'userId').then(paintResults).catch(paintResults);
            } else {
                paintResults();
            }
            var label = document.getElementById('stats-race-label');
            if (label) label.textContent = 'Dual Race · ' + config.amount + ' ' + (config.mode === 'words' ? 'Words' : 'Seconds');
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
            initStatsHeader();
            if (typeof window.usertypo_unlockStatsScroll === 'function') {
                window.usertypo_unlockStatsScroll();
            }
            window.scrollTo(0, 0);
        }

        async function leaveDual() {
            try {
                if (roomId && window.usertypoMultiplayer) {
                    await window.usertypoMultiplayer.leaveRace(roomId);
                }
            } catch (_) { /* ignore */ }
            if (typeof window.navigateTo === 'function') window.navigateTo('/friends');
        }

        async function requestRematch() {
            if (state !== 'finished' || !config || selfRematchVoted) return;
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
                // Local 3→2→1 tape animation; ignore server tick values (same as rooms).
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
            listen('race-player-left', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId || payload[1] === selfIndex) return;
                opponentLeft = true;
                if (window.usertypoNotifications) {
                    window.usertypoNotifications.showToast('Your opponent left. Finish the test normally.', 'person_remove');
                }
            });
            listen('race-finished', function (event) { showResults(event.detail); });
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
                if (payload.config) config = payload.config;
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
            if (!roomId || !window.usertypoMultiplayer) {
                if (typeof window.navigateTo === 'function') window.navigateTo('/friends');
                return;
            }
            if (isReloadNavigation()) {
                redirectAfterRefresh();
                return;
            }
            prepareWaitingTestView();
            bindEvents();
            bindResultActions();
            window.addEventListener('resize', function () {
                if (!words.length) return;
                if (state === 'countdown' || state === 'joining') {
                    syncCountdownLayout(!!document.getElementById('char-0-0')
                        && document.getElementById('char-0-0').style.opacity !== '0');
                    return;
                }
                updateLineLayout();
                updateCaret();
            }, { signal: signal });
            try {
                var response = await window.usertypoMultiplayer.joinMatch(roomId);
                config = response.room && response.room.config;
                players = response.room && response.room.players || [];
                bot = response.room && response.room.bot || null;
                matchReason = response.room && response.room.reason || '';
                selfUserId = window.usertypoMultiplayer.getReadyState()
                    && window.usertypoMultiplayer.getReadyState().userId || '';
                if (response.state === 'racing' && response.race) {
                    countdownSequenceStarted = true;
                    introBusy = false;
                    beginActualRace(response.race);
                    return;
                }
                if (response.state === 'countdown') {
                    ensureCountdownSequence();
                    return;
                }
                prepareWaitingTestView();
            } catch (error) {
                showMessage('Could not join dual', error.message);
                setTimeout(function () {
                    if (typeof window.navigateTo === 'function') window.navigateTo('/friends');
                }, 1800);
            }
        }

        function cleanup() {
            abortCountdownIntro();
            pendingRacePayload = null;
            countdownSequenceStarted = false;
            clearInterval(updateTimer);
            if (opponentAnimationFrame) cancelAnimationFrame(opponentAnimationFrame);
            opponentAnimationFrame = null;
            // Always leave so dual membership cannot stick after navigating away.
            if (roomId && window.usertypoMultiplayer) {
                window.usertypoMultiplayer.leaveRace(roomId);
            }
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
