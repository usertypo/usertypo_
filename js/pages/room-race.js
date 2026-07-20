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
        if (!roomCode) {
            var joinPath = String(window.location.pathname || '').match(/^\/join\/(\d{4})$/);
            if (joinPath) roomCode = joinPath[1];
        }
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
        var isHost = false;
        var invitePanelOpen = false;
        var invitedFriendIds = {};
        var orbitRing = null;
        var tooltipPortal = null;
        var hostModal = null;
        var startConfirmModal = null;
        var MIN_READY_TO_START = 3;
        var DEFAULT_AVATAR = 'https://lh3.googleusercontent.com/aida-public/AB6AXuBd5QYkWEOQDXxyr6FSYGgWzXrwAJc0aZJNtLl08WWTTeuyLWRDgM2P7HUIZJOpXvyWYhl1ii2Uc9ah0BbFpDURantJBVxP01QUheo3Uoe-UGhDm6VWFAMJdz3gqVP5ts18h9tr57C4x9tk3y3cTzWuITnRqYhIVRgNGa2TBtgkHQYy1gv8mG1lmGmEBQyj44dlxXRL-aYAqXZEtROF1FL1NQ3VsmjsLy524jI57waV58inpM8NC_NexyhevbBemg2DkNRmcSRfqMve';

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
        var readyButtonLabel = document.getElementById('ready-btn-label');
        var countdownOverlay = null;

        function getJoinLink() {
            var origin = window.location.origin || '';
            return origin + '/room?code=' + encodeURIComponent(roomCode || '');
        }

        function countReadyPlayers() {
            if (!room || !Array.isArray(room.players)) return 0;
            return room.players.filter(function (player) {
                return player.status !== 'left' && player.ready;
            }).length;
        }

        function getSelfPlayer() {
            if (!room || !Array.isArray(room.players)) return null;
            return room.players.find(function (player) { return player.userId === selfUserId; }) || null;
        }

        function refreshDomRefs() {
            readyButton = document.getElementById('ready-btn');
            readyButtonLabel = document.getElementById('ready-btn-label')
                || (readyButton && readyButton.querySelector('span'));
            orbitRing = document.getElementById('lobby-orbit-ring');
            tooltipPortal = document.getElementById('orbit-tooltip-portal');
            hostModal = document.getElementById('host-player-modal');
            startConfirmModal = document.getElementById('start-confirm-modal');
        }

        function layoutOrbitPlayers(guests) {
            refreshDomRefs();
            if (!orbitRing) return;
            orbitRing.innerHTML = '';
            var count = guests.length;
            if (!count) return;
            var step = 360 / count;
            guests.forEach(function (player, index) {
                var arm = document.createElement('div');
                arm.className = 'orbit-arm';
                arm.style.setProperty('--arm-angle', (step * index) + 'deg');
                arm.style.setProperty('--pulse-delay', (-(6 / Math.max(count, 1)) * index) + 's');
                var node = document.createElement('div');
                node.className = 'orbit-counter';
                node.innerHTML =
                    '<div class="orbit-pulse">' +
                        '<div class="player-node' + (player.ready ? ' is-ready' : '') + '" data-player-name="' + escapeHtml(player.name) + '">' +
                            '<div class="player-avatar-ring">' +
                                '<img class="player-node-img" alt="' + escapeHtml(player.name) + '" src="' + escapeHtml(player.avatarUrl || DEFAULT_AVATAR) + '">' +
                            '</div>' +
                            '<div class="player-ready-dot"></div>' +
                        '</div>' +
                    '</div>';
                arm.appendChild(node);
                orbitRing.appendChild(arm);
            });
            if (!orbitRing.dataset.tooltipBound) {
                orbitRing.dataset.tooltipBound = '1';
                orbitRing.addEventListener('mouseover', function (event) {
                    var node = event.target && event.target.closest ? event.target.closest('.player-node') : null;
                    if (!node || !tooltipPortal) return;
                    var rect = node.getBoundingClientRect();
                    tooltipPortal.textContent = node.getAttribute('data-player-name') || '';
                    tooltipPortal.style.left = (rect.left + rect.width / 2) + 'px';
                    tooltipPortal.style.top = rect.top + 'px';
                    tooltipPortal.classList.add('visible');
                }, { signal: signal });
                orbitRing.addEventListener('mouseout', function (event) {
                    var node = event.target && event.target.closest ? event.target.closest('.player-node') : null;
                    if (!node || !tooltipPortal) return;
                    var related = event.relatedTarget;
                    if (related && node.contains(related)) return;
                    tooltipPortal.classList.remove('visible');
                }, { signal: signal });
            }
        }

        function renderHostModalList() {
            var list = document.getElementById('host-players-list');
            if (!list || !room) return;
            var rows = room.players.slice().sort(function (a, b) {
                if (a.userId === room.hostUserId) return -1;
                if (b.userId === room.hostUserId) return 1;
                return a.index - b.index;
            });
            list.innerHTML = rows.map(function (player) {
                var isRoomHost = player.userId === room.hostUserId;
                var badge = player.ready
                    ? '<span class="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-full whitespace-nowrap">Ready</span>'
                    : '<span class="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white/5 border border-white/10 px-2 py-1 rounded-full whitespace-nowrap">Waiting</span>';
                var imgClass = 'w-9 h-9 rounded-full border object-cover shrink-0 ' + (isRoomHost ? 'border-2 border-primary' : 'border-white/10');
                var imgStyle = player.ready ? ' style="box-shadow:0 0 8px rgba(0,208,255,0.35)"' : '';
                return '<div class="flex items-center gap-3 px-3 py-2.5 rounded-xl ' + (isRoomHost ? 'bg-primary/5 border border-primary/10' : 'hover:bg-white/5 transition-colors') + '">' +
                    '<img src="' + escapeHtml(player.avatarUrl || DEFAULT_AVATAR) + '" class="' + imgClass + '"' + imgStyle + '>' +
                    '<div class="flex-1 min-w-0">' +
                        '<span class="text-sm font-semibold text-on-surface">' + escapeHtml(player.name) + '</span>' +
                        (isRoomHost ? '<span class="text-[9px] text-primary font-bold uppercase tracking-widest ml-2">Host</span>' : '') +
                    '</div>' +
                    badge +
                '</div>';
            }).join('');
        }

        function updateLobbyButtons() {
            refreshDomRefs();
            if (!readyButton || !readyButtonLabel || !room) return;
            var readyCount = countReadyPlayers();
            var totalPlayers = room.players.filter(function (player) {
                return player.status !== 'left';
            }).length;
            var self = getSelfPlayer();
            isHost = !!(room.hostUserId && selfUserId && room.hostUserId === selfUserId);
            readyButton.classList.remove('is-disabled');
            readyButton.disabled = false;
            readyButton.removeAttribute('aria-disabled');

            if (isHost && self && self.ready) {
                readyButton.dataset.mode = 'start';
                var canStart = readyCount >= MIN_READY_TO_START;
                readyButtonLabel.textContent = 'Start Match (' + readyCount + ' ready)';
                if (!canStart) {
                    readyButton.classList.add('is-disabled');
                    readyButton.disabled = true;
                    readyButton.setAttribute('aria-disabled', 'true');
                }
                return;
            }

            readyButton.dataset.mode = 'ready';
            if (self && self.ready) {
                readyButton.disabled = true;
                readyButtonLabel.textContent = 'Ready (' + readyCount + '/' + totalPlayers + ')';
            } else {
                readyButtonLabel.textContent = 'Ready Up (' + readyCount + '/' + totalPlayers + ')';
            }
        }

        async function renderInviteFriends() {
            var list = document.getElementById('invite-friends-list');
            if (!list) return;
            if (!window.usertypoFriends) {
                list.innerHTML = '<p class="text-xs text-slate-500 italic px-2 py-3">Sign in to invite friends.</p>';
                return;
            }
            try {
                var data = await window.usertypoFriends.loadDashboard();
                var inRoom = {};
                (room && room.players || []).forEach(function (player) { inRoom[player.userId] = true; });
                var friends = (data.friends || []).filter(function (friend) {
                    return friend && friend.user_id && !inRoom[friend.user_id];
                }).sort(function (a, b) {
                    return (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0);
                });
                if (!friends.length) {
                    list.innerHTML = '<p class="text-xs text-slate-500 italic px-2 py-3">No friends available to invite.</p>';
                    return;
                }
                list.innerHTML = friends.map(function (friend) {
                    var invited = !!invitedFriendIds[friend.user_id];
                    return '<div class="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors">' +
                        '<div class="w-9 h-9 rounded-full bg-cover bg-center border border-white/10 shrink-0" style="background-image:url(\'' + escapeHtml(friend.avatar_url || DEFAULT_AVATAR) + '\')"></div>' +
                        '<span class="flex-1 text-sm font-semibold text-on-surface truncate">' + escapeHtml(friend.username || friend.display_name || 'Friend') + '</span>' +
                        '<button type="button" class="room-invite-friend-btn text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-all ' +
                            (invited
                                ? 'bg-white/5 text-slate-500 border-white/10 cursor-default'
                                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary hover:text-on-primary') +
                            '" data-friend-id="' + escapeHtml(friend.user_id) + '"' + (invited ? ' disabled' : '') + '>' +
                            (invited ? 'Invited' : 'Invite') +
                        '</button>' +
                    '</div>';
                }).join('');
                list.querySelectorAll('.room-invite-friend-btn').forEach(function (button) {
                    button.addEventListener('click', function () {
                        inviteFriend(button.getAttribute('data-friend-id'), button);
                    }, { signal: signal });
                });
            } catch (error) {
                list.innerHTML = '<p class="text-xs text-slate-500 italic px-2 py-3">Could not load friends.</p>';
            }
        }

        async function inviteFriend(friendId, buttonEl) {
            if (!friendId || !roomId) return;
            try {
                await window.usertypoMultiplayer.inviteToRoom(roomId, friendId);
                invitedFriendIds[friendId] = true;
                if (buttonEl) {
                    buttonEl.disabled = true;
                    buttonEl.textContent = 'Invited';
                    buttonEl.className = 'room-invite-friend-btn text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-all bg-white/5 text-slate-500 border-white/10 cursor-default';
                }
                window.usertypoNotifications?.showToast('Invite sent.', 'send');
            } catch (error) {
                window.usertypoNotifications?.showToast(error.message, 'error');
            }
        }

        function copyText(value, iconId) {
            if (!value) return;
            var icon = iconId ? document.getElementById(iconId) : null;
            navigator.clipboard.writeText(value).then(function () {
                if (icon) {
                    icon.textContent = 'check';
                    setTimeout(function () { icon.textContent = 'content_copy'; }, 1200);
                }
                window.usertypoNotifications?.showToast('Copied to clipboard.', 'content_copy');
            }).catch(function () {
                window.usertypoNotifications?.showToast('Could not copy.', 'error');
            });
        }

        function setInvitePanelOpen(open) {
            invitePanelOpen = !!open;
            var panel = document.getElementById('invite-options');
            var icon = document.getElementById('invite-toggle-icon');
            var button = document.getElementById('invite-toggle-btn');
            if (!panel) return;
            panel.classList.toggle('opacity-100', invitePanelOpen);
            panel.classList.toggle('pointer-events-auto', invitePanelOpen);
            panel.classList.toggle('translate-y-0', invitePanelOpen);
            panel.classList.toggle('opacity-0', !invitePanelOpen);
            panel.classList.toggle('pointer-events-none', !invitePanelOpen);
            panel.classList.toggle('translate-y-4', !invitePanelOpen);
            if (icon) icon.textContent = invitePanelOpen ? 'close' : 'add';
            if (button) button.classList.toggle('scale-110', invitePanelOpen);
            if (invitePanelOpen) renderInviteFriends();
        }

        function openHostModal() {
            refreshDomRefs();
            if (!hostModal) return;
            renderHostModalList();
            hostModal.classList.remove('opacity-0', 'pointer-events-none');
            hostModal.classList.add('opacity-100', 'pointer-events-auto');
            var content = document.getElementById('host-modal-content');
            if (content) {
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }
        }

        function closeHostModal() {
            if (!hostModal) return;
            hostModal.classList.add('opacity-0', 'pointer-events-none');
            hostModal.classList.remove('opacity-100', 'pointer-events-auto');
            var content = document.getElementById('host-modal-content');
            if (content) {
                content.classList.remove('scale-100');
                content.classList.add('scale-95');
            }
        }

        function openStartConfirmModal() {
            if (!startConfirmModal) return;
            var waiting = (room.players || []).filter(function (player) {
                return player.joined && !player.ready && player.userId !== room.hostUserId;
            });
            var message = document.getElementById('start-confirm-message');
            if (message) {
                message.textContent = waiting.length
                    ? waiting.map(function (player) { return player.name; }).join(', ') + ' are still not ready. Would you like to start the match anyway?'
                    : 'Some players are still not ready. Would you like to start the match anyway?';
            }
            startConfirmModal.classList.remove('opacity-0', 'pointer-events-none');
            startConfirmModal.classList.add('opacity-100', 'pointer-events-auto');
            var content = document.getElementById('start-confirm-content');
            if (content) {
                content.classList.remove('scale-95');
                content.classList.add('scale-100');
            }
        }

        function closeStartConfirmModal() {
            if (!startConfirmModal) return;
            startConfirmModal.classList.add('opacity-0', 'pointer-events-none');
            startConfirmModal.classList.remove('opacity-100', 'pointer-events-auto');
            var content = document.getElementById('start-confirm-content');
            if (content) {
                content.classList.remove('scale-100');
                content.classList.add('scale-95');
            }
        }

        async function startMatch(force) {
            if (!isHost || !roomId) return;
            try {
                await window.usertypoMultiplayer.startRoom(roomId, !!force);
                closeStartConfirmModal();
            } catch (error) {
                var message = String(error && error.message || '');
                if (!force && /not ready/i.test(message)) {
                    openStartConfirmModal();
                    return;
                }
                window.usertypoNotifications?.showToast(message, 'error');
            }
        }

        async function leaveRoomAndGoFriends() {
            state = 'closed';
            try {
                if (roomId && window.usertypoMultiplayer) {
                    await window.usertypoMultiplayer.leaveRace(roomId);
                }
            } catch (_) { /* ignore */ }
            window.navigateTo?.('/friends');
        }

        function bindLobbyUI() {
            refreshDomRefs();

            if (readyButton) {
                readyButton.addEventListener('click', function () { readyUp(); }, { signal: signal });
            }
            document.addEventListener('keydown', function (event) {
                if (event.key !== 'Enter' || state !== 'lobby') return;
                if (startConfirmModal && startConfirmModal.classList.contains('opacity-100')) return;
                var tag = (event.target && event.target.tagName || '').toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
                event.preventDefault();
                readyUp();
            }, { signal: signal });

            var hostBtn = document.getElementById('lobby-host-btn');
            if (hostBtn) hostBtn.addEventListener('click', openHostModal, { signal: signal });
            var closeHostModalBtn = document.getElementById('close-host-modal-btn');
            var hostModalBackdrop = document.getElementById('host-modal-backdrop');
            if (closeHostModalBtn) closeHostModalBtn.addEventListener('click', closeHostModal, { signal: signal });
            if (hostModalBackdrop) hostModalBackdrop.addEventListener('click', closeHostModal, { signal: signal });

            var inviteToggle = document.getElementById('invite-toggle-btn');
            if (inviteToggle) {
                inviteToggle.addEventListener('click', function (event) {
                    event.stopPropagation();
                    setInvitePanelOpen(!invitePanelOpen);
                }, { signal: signal });
            }
            document.addEventListener('click', function (event) {
                if (!invitePanelOpen) return;
                if (!event.target.closest('#invite-menu-container')) setInvitePanelOpen(false);
            }, { signal: signal });

            var copyRoomIdBtn = document.getElementById('copy-room-id-btn');
            var copyJoinLinkBtn = document.getElementById('copy-join-link-btn');
            if (copyRoomIdBtn) {
                copyRoomIdBtn.addEventListener('click', function () {
                    copyText(roomCode, 'copy-room-id-icon');
                }, { signal: signal });
            }
            if (copyJoinLinkBtn) {
                copyJoinLinkBtn.addEventListener('click', function () {
                    copyText(getJoinLink(), 'copy-join-link-icon');
                }, { signal: signal });
            }

            var leaveBtn = document.getElementById('leave-btn');
            if (leaveBtn) {
                leaveBtn.removeAttribute('onclick');
                leaveBtn.addEventListener('click', function (event) {
                    event.preventDefault();
                    leaveRoomAndGoFriends();
                }, { signal: signal });
            }

            var chatToggle = document.getElementById('lobby-chat-toggle-btn');
            if (chatToggle) {
                chatToggle.setAttribute('data-coming-soon', 'Chat coming soon');
                chatToggle.setAttribute('title', 'Coming soon');
                chatToggle.addEventListener('click', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    window.usertypoNotifications?.showToast('Chat coming soon', 'chat_bubble');
                }, { signal: signal });
            }

            var startCancel = document.getElementById('start-confirm-cancel');
            var startAccept = document.getElementById('start-confirm-accept');
            var startBackdrop = document.getElementById('start-confirm-backdrop');
            if (startCancel) startCancel.addEventListener('click', closeStartConfirmModal, { signal: signal });
            if (startBackdrop) startBackdrop.addEventListener('click', closeStartConfirmModal, { signal: signal });
            if (startAccept) {
                startAccept.addEventListener('click', function () {
                    startMatch(true);
                }, { signal: signal });
            }
        }

        function handleRoomClosed(payload) {
            var closedId = Array.isArray(payload) ? String(payload[0] || '') : '';
            if (!closedId || (roomId && closedId !== String(roomId))) return;
            state = 'closed';
            window.navigateTo?.('/friends');
        }

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
            isHost = room.hostUserId === selfUserId;
            var title = document.getElementById('lobby-room-name');
            var id = document.getElementById('lobby-room-id');
            var inviteId = document.getElementById('invite-panel-room-id');
            var inviteLink = document.getElementById('invite-panel-join-link');
            var mode = document.getElementById('lobby-mode-text');
            var modifiers = document.getElementById('lobby-modifiers-text');
            if (title) title.textContent = room.roomName || 'Private Room';
            if (id) id.textContent = 'Room ID: ' + roomCode;
            if (inviteId) inviteId.textContent = roomCode;
            if (inviteLink) inviteLink.textContent = getJoinLink();
            if (mode) mode.textContent = config.mode === 'words'
                ? config.amount + ' words'
                : 'Timed: ' + config.amount + ' seconds';
            if (modifiers) modifiers.textContent = [
                config.lang,
                config.punct ? 'Punctuation' : '',
                config.nums ? 'Numbers' : '',
            ].filter(Boolean).join(' · ');

            var host = room.players.find(function (player) { return player.userId === room.hostUserId; });
            var hostWrap = document.getElementById('lobby-host');
            var hostBtn = document.getElementById('lobby-host-btn');
            var hostImage = document.querySelector('#lobby-host img');
            if (hostImage && host) {
                hostImage.src = host.avatarUrl || DEFAULT_AVATAR;
                hostImage.alt = host.name || 'Host';
            }
            if (hostWrap) hostWrap.classList.toggle('is-ready', !!(host && host.ready));
            if (host && hostBtn) {
                hostBtn.setAttribute('title', host.name || 'Host');
            }
            var guests = room.players.filter(function (player) {
                return player.userId !== room.hostUserId && player.status !== 'left';
            });
            layoutOrbitPlayers(guests);
            updateLobbyButtons();
            if (hostModal && !hostModal.classList.contains('opacity-0')) renderHostModalList();
            if (invitePanelOpen) renderInviteFriends();
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
            listen('room-closed', function (event) { handleRoomClosed(event.detail); });
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
            isHost = !!(room.hostUserId && selfUserId && room.hostUserId === selfUserId);
            var self = getSelfPlayer();
            if (isHost && self && self.ready) {
                if (countReadyPlayers() < MIN_READY_TO_START) {
                    window.usertypoNotifications?.showToast('At least 3 players must be ready to start.', 'groups');
                    return;
                }
                var waiting = room.players.filter(function (player) {
                    return player.status !== 'left' && !player.ready;
                });
                if (waiting.length) {
                    openStartConfirmModal();
                    return;
                }
                await startMatch(false);
                return;
            }
            if (self && self.ready) return;
            try {
                await window.usertypoMultiplayer.setRoomReady(roomId);
            } catch (error) {
                window.usertypoNotifications?.showToast(error.message, 'error');
            }
        }

        async function ensureRoomMembership() {
            if (!roomCode) return;
            try {
                var joinResult = await window.usertypoMultiplayer.joinRoomCode(roomCode);
                if (joinResult && joinResult.roomId) roomId = joinResult.roomId;
            } catch (error) {
                var message = String(error && error.message || '');
                if (/full/i.test(message)) {
                    window.usertypoNotifications?.showToast('This room is full.', 'groups');
                    throw error;
                }
                // If already stuck in another match, leave it and retry once.
                if (/already in a match/i.test(message)) {
                    try {
                        await window.usertypoMultiplayer.leaveRace('');
                    } catch (_) { /* ignore */ }
                    var retry = await window.usertypoMultiplayer.joinRoomCode(roomCode);
                    if (retry && retry.roomId) roomId = retry.roomId;
                    return;
                }
                throw error;
            }
        }

        async function init() {
            if (!window.usertypoMultiplayer) {
                window.navigateTo?.('/friends');
                return;
            }
            refreshDomRefs();
            bindLobbyUI();
            try {
                var nav = performance.getEntriesByType('navigation');
                var pathNow = String(window.location.pathname || '');
                var isRoomPath = pathNow === '/room' || /^\/join\/\d{4}$/.test(pathNow);
                if (isRoomPath && nav.length && nav[0].type === 'reload') {
                    window.usertypoNotifications?.showToast('You left the room because the page was refreshed.', 'cancel');
                    window.navigateTo?.('/friends');
                    return;
                }
            } catch (_) { /* ignore */ }
            bindEvents();
            showLobbyMessage('Joining', 'Connecting to the room.');
            try {
                await window.usertypoMultiplayer.connect();
                selfUserId = window.usertypoMultiplayer.getReadyState()?.userId || '';
                if (!selfUserId) {
                    throw new Error('Sign in to join a room.');
                }
                // Always resolve membership by code when present (invite link / pin join).
                if (roomCode) {
                    await ensureRoomMembership();
                }
                if (!roomId) {
                    throw new Error('Room not found. Check the Room ID and try again.');
                }
                var response = await window.usertypoMultiplayer.joinMatch(roomId);
                room = response.room;
                config = room.config;
                roomCode = room.roomCode || roomCode;
                isHost = room.hostUserId === selfUserId;
                state = 'lobby';
                renderLobby(room);
                hideLobbyMessage();
            } catch (error) {
                var msg = String(error && error.message || 'Room not found');
                if (/full/i.test(msg)) {
                    window.usertypoNotifications?.showToast('This room is full.', 'groups');
                } else {
                    window.usertypoNotifications?.showToast(msg, 'error');
                }
                showLobbyMessage('Could not join', msg);
                setTimeout(function () { window.navigateTo?.('/friends'); }, 1800);
            }
        }

        function cleanup() {
            clearInterval(updateTimer);
            closeHostModal();
            closeStartConfirmModal();
            if (!finished && state !== 'waiting-result' && state !== 'closed' && roomId) {
                try {
                    window.usertypoMultiplayer?.leaveRace(roomId);
                } catch (_) { /* ignore */ }
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
