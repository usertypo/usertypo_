/**
 * Custom room controller (2–8 players).
 * Room membership, countdown, prompt, progress and results are server-owned.
 */
(function () {
    'use strict';

    var initialDocumentPath = window.location.pathname;

    function createController() {
        var abort = new AbortController();
        var signal = abort.signal;
        var params = new URLSearchParams(window.location.search);
        var roomId = params.get('room') || '';
        var roomCode = params.get('code') || '';
        var state = 'joining';
        var room = null;
        var config = null;
        var words = [];
        var selfUserId = '';
        var selfIndex = -1;
        var startedAt = 0;
        var currentWordIndex = 0;
        var currentCharIndex = 0;
        var completedWords = 0;
        var sequence = 0;
        var totalKeystrokes = 0;
        var errors = 0;
        var lockedAt = null;
        var errorHistory = [];
        var updateTimer = null;
        var progressByIndex = {};
        var finished = false;

        var lobbyView = document.getElementById('lobby-view');
        var testView = document.getElementById('test-view');
        var statsView = document.getElementById('stats-view');
        var textContainer = document.getElementById('room-text-container');
        var typingArea = document.getElementById('room-typing-area');
        var caret = document.getElementById('caret');
        var progressDisplay = document.getElementById('room-word-progress');
        var progressBar = document.getElementById('room-word-progress-bar');
        var wpmDisplay = document.getElementById('room-wpm-display');
        var accuracyDisplay = document.getElementById('room-acc-display');
        var leaderboard = document.getElementById('live-leaderboard');
        var readyButton = document.getElementById('ready-btn');
        var countdownOverlay = null;

        function listen(name, handler) {
            window.addEventListener('usertypo:multiplayer:' + name, handler, { signal: signal });
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function showLobbyMessage(message, detail) {
            if (!countdownOverlay) {
                countdownOverlay = document.createElement('div');
                countdownOverlay.className = 'absolute inset-0 z-30 flex flex-col items-center justify-center rounded-full bg-background-dark/90 text-center';
                document.getElementById('lobby-orbit-system')?.appendChild(countdownOverlay);
            }
            countdownOverlay.innerHTML =
                '<div class="text-5xl font-display font-bold text-primary">' + escapeHtml(message) + '</div>' +
                (detail ? '<div class="text-xs text-slate-400 mt-2">' + escapeHtml(detail) + '</div>' : '');
            countdownOverlay.classList.remove('hidden');
        }

        function hideLobbyMessage() {
            countdownOverlay?.classList.add('hidden');
        }

        function renderLobby(nextRoom) {
            if (!nextRoom || nextRoom.roomId !== roomId) return;
            room = nextRoom;
            config = room.config;
            roomCode = room.roomCode || roomCode;
            var title = document.getElementById('lobby-room-name');
            var id = document.getElementById('lobby-room-id');
            var inviteId = document.getElementById('invite-panel-room-id');
            var mode = document.getElementById('lobby-mode-text');
            var modifiers = document.getElementById('lobby-modifiers-text');
            if (title) title.textContent = room.roomName || 'Private Room';
            if (id) id.textContent = 'Room ID: ' + roomCode;
            if (inviteId) inviteId.textContent = roomCode;
            if (mode) mode.textContent = config.mode === 'words'
                ? config.amount + ' words'
                : 'Timed: ' + config.amount + ' seconds';
            if (modifiers) modifiers.textContent = [
                config.lang,
                config.punct ? 'Punctuation' : '',
                config.nums ? 'Numbers' : '',
            ].filter(Boolean).join(' · ');

            var host = room.players.find(function (player) { return player.userId === room.hostUserId; });
            var hostImage = document.querySelector('#lobby-host img');
            if (hostImage && host && host.avatarUrl) hostImage.src = host.avatarUrl;
            var guests = room.players.filter(function (player) { return player.userId !== room.hostUserId; });
            var nodes = Array.from(document.querySelectorAll('#lobby-orbit-ring .player-node'));
            nodes.forEach(function (node, index) {
                var player = guests[index];
                var wrapper = node.parentElement;
                if (!player) {
                    if (wrapper) wrapper.classList.add('hidden');
                    return;
                }
                if (wrapper) wrapper.classList.remove('hidden');
                node.dataset.playerName = player.name;
                node.classList.toggle('is-ready', !!player.ready);
                var image = node.querySelector('img');
                if (image) {
                    image.alt = player.name;
                    if (player.avatarUrl) image.src = player.avatarUrl;
                }
            });
            var self = room.players.find(function (player) { return player.userId === selfUserId; });
            if (readyButton) {
                readyButton.disabled = !!(self && self.ready);
                readyButton.querySelector('span').textContent = self && self.ready ? 'Ready' : 'Ready Up';
            }
        }

        function switchToTest() {
            lobbyView.classList.add('hidden');
            lobbyView.style.display = 'none';
            testView.classList.remove('hidden', 'opacity-0');
            testView.style.display = 'flex';
        }

        function renderText() {
            textContainer.querySelectorAll('.word').forEach(function (element) { element.remove(); });
            words.forEach(function (word, wordIndex) {
                var wordElement = document.createElement('span');
                wordElement.id = 'room-word-' + wordIndex;
                wordElement.className = 'word inline-block mr-[0.65em] mb-[0.3em]';
                word.split('').forEach(function (character, charIndex) {
                    var characterElement = document.createElement('span');
                    characterElement.id = 'room-char-' + wordIndex + '-' + charIndex;
                    characterElement.className = 'char text-slate-500 transition-colors duration-75';
                    characterElement.textContent = character;
                    wordElement.appendChild(characterElement);
                });
                textContainer.appendChild(wordElement);
            });
            requestAnimationFrame(updateCaret);
        }

        function updateCaret() {
            var word = words[currentWordIndex];
            if (!word) return;
            var index = Math.min(currentCharIndex, word.length - 1);
            var target = document.getElementById('room-char-' + currentWordIndex + '-' + index);
            if (!target) return;
            var targetRect = target.getBoundingClientRect();
            var containerRect = textContainer.getBoundingClientRect();
            caret.style.position = 'absolute';
            caret.style.display = 'block';
            caret.style.left = (targetRect.left - containerRect.left + (currentCharIndex >= word.length ? targetRect.width : 0)) + 'px';
            caret.style.top = (targetRect.top - containerRect.top) + 'px';
            caret.style.height = targetRect.height + 'px';
            var wordElement = document.getElementById('room-word-' + currentWordIndex);
            var areaRect = typingArea.getBoundingClientRect();
            if (wordElement && wordElement.getBoundingClientRect().top - areaRect.top > areaRect.height * 0.55) {
                var lineHeight = parseFloat(getComputedStyle(typingArea).lineHeight || '42');
                textContainer.style.transform = 'translateY(-' + Math.max(0, wordElement.offsetTop - lineHeight) + 'px)';
            }
        }

        function paint(index, key, correct) {
            var word = words[currentWordIndex];
            var wordElement = document.getElementById('room-word-' + currentWordIndex);
            var element = document.getElementById('room-char-' + currentWordIndex + '-' + index);
            if (!element) {
                element = document.createElement('span');
                element.id = 'room-char-' + currentWordIndex + '-' + index;
                element.className = 'char extra';
                wordElement.appendChild(element);
            }
            element.textContent = index < word.length ? word[index] : key;
            element.className = 'char ' + (index >= word.length ? 'extra ' : '') + (
                correct
                    ? 'text-primary drop-shadow-[0_0_5px_rgba(0,208,255,0.4)]'
                    : 'text-error drop-shadow-[0_0_7px_rgba(255,80,80,0.75)]'
            );
        }

        function resetCharacter(index) {
            var element = document.getElementById('room-char-' + currentWordIndex + '-' + index);
            if (!element) return;
            if (element.classList.contains('extra')) {
                element.remove();
                return;
            }
            element.className = 'char text-slate-500 transition-colors duration-75';
            element.textContent = words[currentWordIndex][index] || '';
        }

        function correctChars() {
            var total = 0;
            for (var i = 0; i < completedWords && i < words.length; i += 1) {
                total += words[i].length;
                if (i > 0) total += 1;
            }
            return total;
        }

        function currentMetrics() {
            var minutes = startedAt ? Math.max((Date.now() - startedAt) / 60_000, 1 / 120) : 1 / 120;
            var correct = correctChars();
            return {
                wpm: Math.max(0, Math.round((correct / 5) / minutes)),
                accuracy: totalKeystrokes ? Math.max(0, Math.min(100, Math.round((correct / totalKeystrokes) * 100))) : 100,
                correct: correct,
            };
        }

        function sendProgress(finalPacket) {
            if (!((completedWords > 0 && completedWords % 3 === 0) || finalPacket)) return;
            sequence += 1;
            window.usertypoMultiplayer
                .sendProgress(roomId, sequence, completedWords, totalKeystrokes, finalPacket)
                .catch(function (error) {
                    window.usertypoNotifications?.showToast(error.message, 'error');
                });
        }

        function finishWord() {
            completedWords += 1;
            currentWordIndex += 1;
            currentCharIndex = 0;
            lockedAt = null;
            errorHistory = [];
            var isFinal = config.mode === 'words' && completedWords >= config.amount;
            sendProgress(isFinal);
            if (isFinal) {
                state = 'waiting-result';
                window.usertypoNotifications?.showToast('Finished — waiting for the remaining players.', 'check_circle');
                return;
            }
            updateCaret();
        }

        function handleKey(event) {
            if (state !== 'racing' || event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === 'Backspace') {
                event.preventDefault();
                if (lockedAt != null && errorHistory.length) {
                    var errorEntry = errorHistory.pop();
                    if (errorEntry.kind === 'space') {
                        currentWordIndex = errorEntry.wordIndex;
                        currentCharIndex = errorEntry.charIndex;
                    } else {
                        currentWordIndex = errorEntry.wordIndex;
                        currentCharIndex = errorEntry.charIndex;
                        resetCharacter(currentCharIndex);
                    }
                    if (!errorHistory.length) lockedAt = null;
                    updateCaret();
                } else if (currentCharIndex > 0) {
                    currentCharIndex -= 1;
                    resetCharacter(currentCharIndex);
                    updateCaret();
                }
                return;
            }
            var key = event.key === 'Spacebar' ? ' ' : event.key;
            if (key.length !== 1) return;
            event.preventDefault();
            var word = words[currentWordIndex];
            if (!word) return;

            if (lockedAt != null) {
                if (errorHistory.length >= 20) return;
                totalKeystrokes += 1;
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
                    paint(currentCharIndex, key, false);
                    currentCharIndex += 1;
                }
                errors += 1;
                updateCaret();
                return;
            }
            totalKeystrokes += 1;
            if (key === ' ') {
                if (currentCharIndex === word.length) finishWord();
                else {
                    lockedAt = currentCharIndex;
                    errorHistory = [{
                        kind: 'char',
                        wordIndex: currentWordIndex,
                        charIndex: currentCharIndex,
                    }];
                    paint(currentCharIndex, key, false);
                    currentCharIndex += 1;
                    errors += 1;
                    updateCaret();
                }
                return;
            }
            if (key === word[currentCharIndex]) paint(currentCharIndex, key, true);
            else {
                lockedAt = currentCharIndex;
                errorHistory = [{
                    kind: 'char',
                    wordIndex: currentWordIndex,
                    charIndex: currentCharIndex,
                }];
                paint(currentCharIndex, key, false);
                errors += 1;
            }
            currentCharIndex += 1;
            if (lockedAt == null && config.mode === 'words' && currentWordIndex === config.amount - 1 && currentCharIndex === word.length) {
                finishWord();
            } else {
                updateCaret();
            }
        }

        function updateLive() {
            if (state !== 'racing') return;
            var metrics = currentMetrics();
            if (wpmDisplay) wpmDisplay.textContent = metrics.wpm;
            if (accuracyDisplay) accuracyDisplay.textContent = metrics.accuracy + '%';
            var percentage;
            if (config.mode === 'time') {
                var elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
                var remaining = Math.max(0, Math.ceil(config.amount - elapsed));
                progressDisplay.textContent = remaining;
                percentage = Math.min(100, (elapsed / config.amount) * 100);
                if (remaining === 0) {
                    state = 'waiting-result';
                    clearInterval(updateTimer);
                    sendProgress(true);
                }
            } else {
                progressDisplay.innerHTML = completedWords + '<span class="text-slate-500">/</span>' + config.amount;
                percentage = Math.min(100, (completedWords / config.amount) * 100);
            }
            if (progressBar) progressBar.style.width = percentage + '%';
            progressByIndex[selfIndex] = {
                index: selfIndex,
                wpm: metrics.wpm,
                progress: percentage,
                completedWords: completedWords,
            };
            renderLeaderboard();
        }

        function renderLeaderboard() {
            if (!leaderboard || !room) return;
            var rows = room.players.map(function (player) {
                return Object.assign({ index: player.index, wpm: 0, progress: 0 }, progressByIndex[player.index] || {}, {
                    name: player.name,
                    avatarUrl: player.avatarUrl,
                });
            }).sort(function (a, b) {
                return b.progress - a.progress || b.wpm - a.wpm;
            });
            leaderboard.innerHTML = rows.map(function (row, index) {
                return '<div class="player-pill ' + (row.index === selfIndex ? 'me' : '') + ' p-3 rounded-xl border border-white/10 bg-white/[0.035]">' +
                    '<div class="flex items-center gap-3">' +
                    '<span class="text-xs font-bold text-slate-500 w-4">' + (index + 1) + '</span>' +
                    '<div class="min-w-0 flex-1"><div class="text-sm font-bold text-white truncate">' + escapeHtml(row.name) + '</div>' +
                    '<div class="h-1 bg-white/10 rounded-full mt-2 overflow-hidden"><div class="progress-fill h-full bg-primary" style="width:' + Math.min(100, row.progress) + '%"></div></div></div>' +
                    '<span class="text-sm font-mono text-primary">' + Math.round(row.wpm) + '</span>' +
                    '</div></div>';
            }).join('');
        }

        function startRace(payload) {
            if (!payload || payload.roomId !== roomId) return;
            config = payload.config;
            words = payload.words || [];
            room.players = payload.players || room.players;
            startedAt = Date.now() + Math.max(0, Number(payload.startsInMs) || 0);
            var self = room.players.find(function (player) { return player.userId === selfUserId; });
            selfIndex = self ? self.index : 0;
            renderText();
            renderLeaderboard();
            switchToTest();
            setTimeout(function () {
                state = 'racing';
                document.addEventListener('keydown', handleKey, { signal: signal });
                updateTimer = setInterval(updateLive, 200);
                updateLive();
            }, Math.max(0, startedAt - Date.now()));
        }

        function renderResults(payload) {
            if (!Array.isArray(payload) || payload[0] !== roomId) return;
            finished = true;
            state = 'finished';
            clearInterval(updateTimer);
            var results = payload[2] || [];
            var list = document.getElementById('stats-rankings-list');
            var podium = document.getElementById('stats-podium');
            var profileByIndex = {};
            room.players.forEach(function (player) { profileByIndex[player.index] = player; });
            if (podium) {
                podium.innerHTML = results.slice(0, 3).map(function (row, index) {
                    var profile = profileByIndex[row[0]] || { name: row[2] };
                    return '<div class="panel-surface rounded-2xl p-5 text-center min-w-[10rem] ' + (index === 0 ? 'border-primary/40' : '') + '">' +
                        '<div class="text-xs text-slate-500 font-bold">#' + (index + 1) + '</div>' +
                        '<div class="text-white font-bold mt-2 truncate">' + escapeHtml(profile.name) + '</div>' +
                        '<div class="text-3xl text-primary font-mono font-bold mt-2">' + row[3] + '</div>' +
                        '<div class="text-[10px] text-slate-500 uppercase">wpm</div></div>';
                }).join('');
            }
            if (list) {
                list.innerHTML = results.map(function (row, index) {
                    var profile = profileByIndex[row[0]] || { name: row[2] };
                    return '<div class="panel-surface rounded-xl px-5 py-4 flex items-center gap-4">' +
                        '<span class="text-slate-500 font-bold w-6">#' + (index + 1) + '</span>' +
                        '<span class="text-white font-bold flex-1 truncate">' + escapeHtml(profile.name) + '</span>' +
                        '<span class="text-primary font-mono font-bold">' + row[3] + ' WPM</span>' +
                        '<span class="text-slate-400 font-mono text-sm">' + row[4] + '%</span></div>';
                }).join('');
            }
            if (payload[3]) {
                window.usertypoNotifications?.showToast('One or more players left the room during the race.', 'person_remove');
            }
            testView.classList.add('hidden');
            testView.style.display = 'none';
            statsView.classList.remove('hidden', 'opacity-0');
            statsView.style.display = 'flex';
            statsView.classList.add('flex');
            var replay = document.querySelector('#stats-action-buttons button:first-child span:first-child');
            if (replay) replay.textContent = 'Create New Room';
        }

        function bindEvents() {
            listen('room-state', function (event) { renderLobby(event.detail); });
            listen('race-countdown', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId) return;
                showLobbyMessage(payload[1] > 0 ? payload[1] : 'GO', payload[1] > 0 ? 'Get ready' : '');
            });
            listen('race-start', function (event) { startRace(event.detail); });
            listen('race-progress', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload)) return;
                progressByIndex[payload[0]] = {
                    index: payload[0],
                    wpm: payload[1],
                    progress: payload[2],
                    completedWords: payload[4],
                };
                renderLeaderboard();
            });
            listen('race-player-left', function () {
                window.usertypoNotifications?.showToast('A player left the room.', 'person_remove');
            });
            listen('race-finished', function (event) { renderResults(event.detail); });
            listen('match-resumed', function () {
                if (state === 'racing' || state === 'waiting-result') hideLobbyMessage();
            });
        }

        async function readyUp() {
            if (!room || state !== 'lobby') return;
            try {
                await window.usertypoMultiplayer.setRoomReady(roomId);
                readyButton.disabled = true;
                readyButton.querySelector('span').textContent = 'Ready';
            } catch (error) {
                window.usertypoNotifications?.showToast(error.message, 'error');
            }
        }

        async function init() {
            if (!roomId || !window.usertypoMultiplayer) {
                window.navigateTo?.('/friends');
                return;
            }
            try {
                var nav = performance.getEntriesByType('navigation');
                if (initialDocumentPath === '/room' && nav.length && nav[0].type === 'reload') {
                    window.usertypoNotifications?.showToast('You left the room because the page was refreshed.', 'cancel');
                    window.navigateTo?.('/friends');
                    return;
                }
            } catch (_) { /* ignore */ }
            selfUserId = window.usertypoMultiplayer.getReadyState()?.userId || '';
            bindEvents();
            showLobbyMessage('Joining', 'Connecting to the room.');
            try {
                var response = await window.usertypoMultiplayer.joinMatch(roomId);
                room = response.room;
                config = room.config;
                state = 'lobby';
                renderLobby(room);
                hideLobbyMessage();
            } catch (error) {
                showLobbyMessage('Room unavailable', error.message);
                setTimeout(function () { window.navigateTo?.('/friends'); }, 1800);
            }
        }

        function cleanup() {
            clearInterval(updateTimer);
            if (!finished && state !== 'waiting-result' && roomId) {
                var socket = window.usertypoMultiplayer?.getSocket();
                if (socket?.connected) socket.emit('race:leave', roomId);
            }
            abort.abort();
            window.toggleReady = null;
            window.showLobbyView = null;
        }

        window.toggleReady = readyUp;
        window.showLobbyView = function () { window.navigateTo?.('/friends'); };
        return { init: init, cleanup: cleanup, readyUp: readyUp };
    }

    window.usertypoRoomPage = { createController: createController };
})();
