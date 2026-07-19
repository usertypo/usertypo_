/**
 * Multiplayer dual page controller.
 * The server owns room lifecycle/timing; this module owns local typing visuals only.
 */
(function () {
    'use strict';

    var initialDocumentPath = window.location.pathname;

    function createController() {
        var abort = new AbortController();
        var signal = abort.signal;
        var params = new URLSearchParams(window.location.search);
        var roomId = params.get('room') || '';
        var state = 'joining';
        var config = null;
        var words = [];
        var players = [];
        var bot = null;
        var selfUserId = '';
        var selfIndex = -1;
        var opponentIndex = -1;
        var startTime = 0;
        var currentWordIndex = 0;
        var currentCharIndex = 0;
        var completedCorrectWords = 0;
        var packetSequence = 0;
        var totalKeystrokes = 0;
        var errorsMade = 0;
        var extraChars = 0;
        var keystrokeTimes = [];
        var unresolvedError = null;
        var opponentLeft = false;
        var updateTimer = null;
        var localFinished = false;
        var latestResults = null;

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
                return initialDocumentPath === '/dual' && entries.length && entries[0].type === 'reload';
            } catch (_) {
                return false;
            }
        }

        function redirectAfterRefresh() {
            if (window.usertypoNotifications) {
                window.usertypoNotifications.showToast('You left the dual because the page was refreshed.', 'cancel');
            }
            if (typeof window.navigateTo === 'function') window.navigateTo('/friends');
            else window.location.replace('/friends');
        }

        function appendWord(word, wordIndex) {
            var wordElement = document.createElement('span');
            wordElement.id = 'word-' + wordIndex;
            wordElement.className = 'word inline-block mr-[0.65em] mb-[0.3em]';
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
            words.forEach(appendWord);
            requestAnimationFrame(function () {
                if (typingArea) typingArea.style.height = Math.max(112, Math.round(parseFloat(getComputedStyle(typingArea).lineHeight || '42') * 3)) + 'px';
                updateCaret();
            });
        }

        function wordOffset(wordIndex) {
            var offset = 0;
            for (var i = 0; i < wordIndex && i < words.length; i += 1) offset += words[i].length + 1;
            return offset;
        }

        function positionForCompletedWords(completedWords) {
            var index = Math.max(0, Math.min(words.length - 1, completedWords));
            return { wordIndex: index, charIndex: 0 };
        }

        function positionCaretAt(element, wordIndex, charIndex) {
            if (!element || !textContainer || !words[wordIndex]) return;
            var target = document.getElementById('char-' + wordIndex + '-' + Math.min(charIndex, words[wordIndex].length - 1));
            var wordElement = document.getElementById('word-' + wordIndex);
            if (!target || !wordElement) return;
            var targetRect = target.getBoundingClientRect();
            var containerRect = textContainer.getBoundingClientRect();
            var afterLast = charIndex >= words[wordIndex].length;
            element.style.display = 'block';
            element.style.position = 'absolute';
            element.style.left = (targetRect.left - containerRect.left + (afterLast ? targetRect.width : 0)) + 'px';
            element.style.top = (targetRect.top - containerRect.top) + 'px';
            element.style.height = targetRect.height + 'px';

            var areaRect = typingArea.getBoundingClientRect();
            var activeTop = wordElement.getBoundingClientRect().top - areaRect.top;
            if (activeTop > areaRect.height * 0.55) {
                var shift = Math.max(0, activeTop - parseFloat(getComputedStyle(typingArea).lineHeight || '42'));
                textContainer.style.transform = 'translateY(-' + shift + 'px)';
            }
        }

        function updateCaret() {
            positionCaretAt(caret, currentWordIndex, currentCharIndex);
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
            element.textContent = typed;
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
                total += words[i].length;
                if (i > 0) total += 1;
            }
            return total;
        }

        function localStats() {
            var elapsedMinutes = startTime ? Math.max((Date.now() - startTime) / 60_000, 1 / 120) : 1 / 120;
            var correct = currentCorrectChars();
            var wpm = Math.max(0, Math.round((correct / 5) / elapsedMinutes));
            var accuracy = totalKeystrokes ? Math.max(0, Math.min(100, (correct / totalKeystrokes) * 100)) : 100;
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
            if (burstDisplay) burstDisplay.textContent = '0';
            if (config.mode === 'time') {
                var elapsed = Math.max(0, (Date.now() - startTime) / 1000);
                var remaining = Math.max(0, Math.ceil(config.amount - elapsed));
                progressDisplay.textContent = remaining;
                if (progressBar) progressBar.style.width = Math.min(100, (elapsed / config.amount) * 100) + '%';
            } else {
                progressDisplay.innerHTML = completedCorrectWords + '<span class="text-slate-500">/</span>' + config.amount;
                if (progressBar) progressBar.style.width = Math.min(100, (completedCorrectWords / config.amount) * 100) + '%';
            }
        }

        function sendThreeWordPacket(forceFinal) {
            if (!window.usertypoMultiplayer || state !== 'racing') return;
            var shouldSend = completedCorrectWords > 0
                && (completedCorrectWords % 3 === 0 || forceFinal === true);
            if (!shouldSend) return;
            packetSequence += 1;
            window.usertypoMultiplayer
                .sendProgress(roomId, packetSequence, completedCorrectWords, totalKeystrokes)
                .catch(function (error) {
                    if (window.usertypoNotifications) window.usertypoNotifications.showToast(error.message, 'error');
                });
        }

        function completeWord() {
            completedCorrectWords += 1;
            currentWordIndex += 1;
            currentCharIndex = 0;
            unresolvedError = null;
            var finalWord = config.mode === 'words' && completedCorrectWords >= config.amount;
            sendThreeWordPacket(finalWord);
            if (finalWord) {
                localFinished = true;
                state = 'waiting-result';
                showMessage('Finished', 'Waiting for your opponent to complete the test.');
                return;
            }
            updateCaret();
        }

        function handleBackspace(event) {
            event.preventDefault();
            if (currentCharIndex <= 0) return;
            currentCharIndex -= 1;
            resetCharacter(currentWordIndex, currentCharIndex);
            updateCaret();
        }

        function handlePrintable(event) {
            if (state !== 'racing' || localFinished) return;
            var key = event.key === 'Spacebar' ? ' ' : event.key;
            if (key.length !== 1) return;
            event.preventDefault();
            totalKeystrokes += 1;
            keystrokeTimes.push(Date.now());
            var word = words[currentWordIndex];
            if (!word) return;

            if (unresolvedError) {
                var trailing = currentCharIndex - unresolvedError.charIndex;
                if (trailing >= 20) return;
                var expectedAtLock = currentCharIndex === unresolvedError.charIndex
                    ? word[unresolvedError.charIndex]
                    : null;
                if (expectedAtLock && key === expectedAtLock) {
                    paintCharacter(currentWordIndex, currentCharIndex, key, true, false);
                    unresolvedError = null;
                    currentCharIndex += 1;
                } else {
                    paintCharacter(currentWordIndex, currentCharIndex, key, false, true);
                    currentCharIndex += 1;
                    errorsMade += 1;
                }
                updateCaret();
                return;
            }

            if (key === ' ') {
                if (currentCharIndex === word.length) completeWord();
                else {
                    unresolvedError = { wordIndex: currentWordIndex, charIndex: currentCharIndex };
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
            } else {
                unresolvedError = { wordIndex: currentWordIndex, charIndex: currentCharIndex };
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
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === 'Backspace') handleBackspace(event);
            else handlePrintable(event);
        }

        function applyRaceStart(payload) {
            if (!payload || payload.roomId !== roomId) return;
            config = payload.config;
            words = payload.words || [];
            players = payload.players || [];
            bot = payload.bot || null;
            startTime = payload.startsAt;
            selfUserId = window.usertypoMultiplayer.getReadyState()
                && window.usertypoMultiplayer.getReadyState().userId || '';
            var self = players.find(function (player) { return player.userId === selfUserId; });
            var opponent = players.find(function (player) { return player.userId !== selfUserId; });
            selfIndex = self ? self.index : 0;
            opponentIndex = opponent ? opponent.index : (bot ? bot.index : 1);
            if (opponentAvatar && opponent && opponent.avatarUrl) {
                opponentAvatar.style.backgroundImage = "url('" + String(opponent.avatarUrl).replace(/'/g, '%27') + "')";
            }
            renderPrompt();
            updateConfigUi();
            var wait = Math.max(0, startTime - Date.now());
            setTimeout(function () {
                state = 'racing';
                hideMessage();
                document.addEventListener('keydown', onKeyDown, { signal: signal });
                updateTimer = setInterval(updateLiveStats, 200);
                updateLiveStats();
            }, wait);
        }

        function updateConfigUi() {
            var modeAmount = document.getElementById('aci-mode-amt');
            var modeIcon = document.getElementById('aci-mode-icon');
            if (modeAmount) modeAmount.textContent = config.amount;
            if (modeIcon) modeIcon.textContent = config.mode === 'words' ? 'format_align_left' : 'schedule';
            ['punct', 'num'].forEach(function (kind) {
                var enabled = kind === 'punct' ? config.punct : config.nums;
                var element = document.getElementById('aci-' + kind);
                if (!element) return;
                element.classList.toggle('max-w-0', !enabled);
                element.classList.toggle('opacity-0', !enabled);
                element.classList.toggle('max-w-[80px]', enabled);
                element.classList.toggle('opacity-100', enabled);
            });
        }

        function applyOpponentProgress(payload) {
            if (!Array.isArray(payload) || payload[0] !== opponentIndex) return;
            if (opponentWpmDisplay) opponentWpmDisplay.textContent = payload[1];
            var position = positionForCompletedWords(Number(payload[4]) || 0);
            positionCaretAt(opponentCaret, position.wordIndex, position.charIndex);
        }

        function fillCard(prefix, data) {
            function set(id, value) {
                var element = document.getElementById(id);
                if (element) element.textContent = value;
            }
            set(prefix + '-name', data.name);
            var avatar = document.getElementById(prefix + '-avatar');
            if (avatar) {
                avatar.textContent = data.name ? data.name.charAt(0).toUpperCase() : '?';
                if (data.avatarUrl) {
                    avatar.textContent = '';
                    avatar.style.backgroundImage = "url('" + String(data.avatarUrl).replace(/'/g, '%27') + "')";
                    avatar.style.backgroundSize = 'cover';
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
            if (!Array.isArray(payload) || payload[0] !== roomId) return;
            state = 'finished';
            latestResults = payload;
            clearInterval(updateTimer);
            var rows = payload[2] || [];
            var me = players.find(function (player) { return player.userId === selfUserId; }) || { name: 'You', avatarUrl: '' };
            var other = players.find(function (player) { return player.userId !== selfUserId; })
                || { name: bot && bot.name || 'Opponent', avatarUrl: '' };
            var myRow = rows.find(function (row) { return row[0] === selfIndex; }) || [];
            var otherRow = rows.find(function (row) { return row[0] === opponentIndex; }) || [];
            var local = localStats();
            var meData = Object.assign({}, local, {
                name: me.name,
                avatarUrl: me.avatarUrl,
                wpm: myRow[3] == null ? local.wpm : myRow[3],
                accuracy: myRow[4] == null ? local.accuracy : myRow[4],
            });
            var otherData = {
                name: other.name,
                avatarUrl: other.avatarUrl,
                wpm: otherRow[3] || 0,
                accuracy: otherRow[4] || 0,
                time: otherRow[7] && startTime ? Math.round((otherRow[7] - startTime) / 100) / 10 : 0,
                consistency: 0,
                raw: otherRow[3] || 0,
                errors: 0,
                correct: 0,
                total: 0,
                extra: 0,
            };
            var meWon = rows.length && rows[0][0] === selfIndex;
            fillCard('w', meWon ? meData : otherData);
            fillCard('l', meWon ? otherData : meData);
            var label = document.getElementById('stats-race-label');
            if (label) label.textContent = 'Dual Race · ' + config.amount + ' ' + (config.mode === 'words' ? 'Words' : 'Seconds');
            if (payload[3] || opponentLeft) {
                var capture = document.getElementById('stats-capture-area') || statsView;
                var notice = document.createElement('div');
                notice.className = 'mx-auto mb-4 px-4 py-2 rounded-full bg-error/10 border border-error/25 text-error text-sm font-semibold';
                notice.textContent = 'Your opponent left the dual mid-game.';
                capture.insertBefore(notice, capture.firstChild);
            }
            testView.classList.add('hidden');
            testView.style.display = 'none';
            statsView.classList.remove('hidden', 'opacity-0');
            statsView.classList.add('flex');
            statsView.style.display = 'flex';
            window.scrollTo(0, 0);
        }

        function bindEvents() {
            listen('race-countdown', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId) return;
                showMessage(payload[1] > 0 ? String(payload[1]) : 'GO', payload[1] > 0 ? 'Get ready' : '');
            });
            listen('race-start', function (event) { applyRaceStart(event.detail); });
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
            listen('race-invalid', function () {
                state = 'finished';
                showMessage('Race invalid', 'The server rejected implausible progress.');
            });
            listen('disconnected', function () {
                if (state === 'racing' || state === 'joining') showMessage('Connection lost', 'Trying to reconnect to the multiplayer server.');
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
            showMessage('Joining dual', 'Waiting for the other player.');
            bindEvents();
            try {
                var response = await window.usertypoMultiplayer.joinMatch(roomId);
                config = response.room && response.room.config;
                players = response.room && response.room.players || [];
                bot = response.room && response.room.bot || null;
                showMessage('Waiting for opponent', bot ? 'Bot is ready. The countdown will begin shortly.' : 'Both players must open the dual before it starts.');
            } catch (error) {
                showMessage('Could not join dual', error.message);
                setTimeout(function () {
                    if (typeof window.navigateTo === 'function') window.navigateTo('/friends');
                }, 1800);
            }
        }

        function cleanup() {
            clearInterval(updateTimer);
            if (state !== 'finished' && roomId && window.usertypoMultiplayer) {
                var activeSocket = window.usertypoMultiplayer.getSocket();
                if (activeSocket && activeSocket.connected) activeSocket.emit('race:leave', roomId);
            }
            abort.abort();
            latestResults = null;
        }

        return { init: init, cleanup: cleanup };
    }

    window.usertypoDualPage = {
        createController: createController,
    };
})();
