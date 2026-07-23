/**
 * Custom room controller (2–8 players).
 * Room membership, countdown, prompt, progress and results are server-owned.
 */
(function () {
    'use strict';

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
        var wordOffsets = [];
        var lineHeight = 0;
        var updateTimer = null;
        var progressInterval = null;
        var lastProgressSentAt = 0;
        var progressByIndex = {};
        var ROOM_PROGRESS_INTERVAL_MS = 500;
        var finished = false;
        var isHost = false;
        var returnLobbyAgreed = 0;
        var returnLobbyNeeded = 0;
        var selfReturnLobby = false;
        var invitePanelOpen = false;
        var invitedFriendIds = {};
        var orbitRing = null;
        var tooltipPortal = null;
        var tooltipTrackRaf = 0;
        var tooltipTrackNode = null;
        var orbitGuestKey = '';
        var hostModal = null;
        var startConfirmModal = null;
        var MIN_READY_TO_START = 3;

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
        var pendingRacePayload = null;
        var countdownAnimToken = 0;
        var introBusy = false;
        var countdownSequenceStarted = false;
        var countdownTapeLocked = false;
        var countdownTapeTransform = '';
        var countdownTapeBaseX = 0;
        var intentionalLeave = false;
        var prevInRoomIds = {};

        function getJoinLink() {
            var origin = window.location.origin || '';
            return origin + '/room?code=' + encodeURIComponent(roomCode || '');
        }

        function countReadyPlayers() {
            if (!room || !Array.isArray(room.players)) return 0;
            var ready = room.players.filter(function (player) {
                return player.status !== 'left' && player.ready;
            }).length;
            if (room.bot) ready += 1;
            return ready;
        }

        function countRoomParticipants() {
            if (!room || !Array.isArray(room.players)) return room && room.bot ? 1 : 0;
            return room.players.filter(function (player) {
                return player.status !== 'left';
            }).length + (room.bot ? 1 : 0);
        }

        function botAvatarHtml(sizeClass, iconSize) {
            if (window.usertypoPlayerAvatar) {
                var size = 'sm';
                if (sizeClass && /w-12|lb-avatar/.test(sizeClass)) size = sizeClass.indexOf('w-12') >= 0 ? 'lg' : 'sm';
                if (sizeClass && /w-8|w-9/.test(sizeClass)) size = 'sm';
                return window.usertypoPlayerAvatar.render({
                    isBot: true,
                    name: 'Bot',
                    size: size,
                    showLevel: false,
                    className: sizeClass && sizeClass.indexOf('mx-auto') >= 0 ? 'mx-auto mb-2' : '',
                });
            }
            return '<div class="' + sizeClass + ' rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">' +
                '<span class="material-symbols-outlined text-primary" style="font-size:' + (iconSize || 18) + 'px;">smart_toy</span>' +
                '</div>';
        }

        function playerAvatarHtml(player, size, extraClass) {
            if (window.usertypoPlayerAvatar) {
                return window.usertypoPlayerAvatar.fromPlayer(player, {
                    size: size || 'md',
                    className: extraClass || '',
                    showLevel: !player.isBot && !(player.userId && String(player.userId).indexOf('guest_') === 0),
                });
            }
            if (player.isBot) return botAvatarHtml(extraClass || 'w-9 h-9', 18);
            if (player.avatarUrl) {
                return '<img src="' + escapeHtml(player.avatarUrl) + '" class="w-9 h-9 rounded-full object-cover border border-white/10" alt="">';
            }
            return '<div class="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 font-black text-xs">' +
                escapeHtml((player.name || '?').charAt(0).toUpperCase()) + '</div>';
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

        function stopTooltipTracking() {
            tooltipTrackNode = null;
            if (tooltipTrackRaf) {
                cancelAnimationFrame(tooltipTrackRaf);
                tooltipTrackRaf = 0;
            }
            if (tooltipPortal) tooltipPortal.classList.remove('visible');
        }

        function positionOrbitTooltip(node) {
            if (!node || !tooltipPortal) return;
            var rect = node.getBoundingClientRect();
            tooltipPortal.style.left = (rect.left + rect.width / 2) + 'px';
            tooltipPortal.style.top = rect.top + 'px';
        }

        function startTooltipTracking(node) {
            if (!node || !tooltipPortal) return;
            tooltipTrackNode = node;
            tooltipPortal.textContent = node.getAttribute('data-player-name') || '';
            positionOrbitTooltip(node);
            tooltipPortal.classList.add('visible');
            if (tooltipTrackRaf) cancelAnimationFrame(tooltipTrackRaf);
            function tick() {
                if (!tooltipTrackNode || !tooltipPortal) {
                    tooltipTrackRaf = 0;
                    return;
                }
                positionOrbitTooltip(tooltipTrackNode);
                tooltipTrackRaf = requestAnimationFrame(tick);
            }
            tooltipTrackRaf = requestAnimationFrame(tick);
        }

        function bindOrbitImageFade(root) {
            if (!root) return;
            root.querySelectorAll('.player-node-img').forEach(function (img) {
                if (img.dataset.fadeBound) return;
                img.dataset.fadeBound = '1';
                function reveal() { img.classList.add('is-loaded'); }
                if (img.complete && img.naturalWidth) reveal();
                else {
                    img.addEventListener('load', reveal, { once: true });
                    img.addEventListener('error', reveal, { once: true });
                }
            });
        }

        function guestOrbitKey(guests) {
            return guests.map(function (player) {
                return String(player.userId || player.index || player.name || '');
            }).join('|');
        }

        function syncOrbitReadyState(guests) {
            if (!orbitRing) return;
            var byId = {};
            guests.forEach(function (player) {
                byId[String(player.userId || player.index || '')] = player;
            });
            orbitRing.querySelectorAll('.player-node[data-player-id]').forEach(function (node) {
                var player = byId[node.getAttribute('data-player-id') || ''];
                if (!player) return;
                node.classList.toggle('is-ready', !!player.ready);
                node.setAttribute('data-player-name', player.name || '');
            });
        }

        function layoutOrbitPlayers(guests) {
            refreshDomRefs();
            if (!orbitRing) return;
            var nextKey = guestOrbitKey(guests);
            if (nextKey === orbitGuestKey && orbitRing.childElementCount === guests.length) {
                syncOrbitReadyState(guests);
                return;
            }
            orbitGuestKey = nextKey;
            stopTooltipTracking();
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
                var playerId = String(player.userId || player.index || index);
                node.innerHTML =
                    '<div class="orbit-pulse">' +
                        '<div class="player-node' + (player.ready ? ' is-ready' : '') +
                            '" data-player-id="' + escapeHtml(playerId) +
                            '" data-player-name="' + escapeHtml(player.name) + '">' +
                            '<div class="player-avatar-ring">' +
                                playerAvatarHtml(player, 'lg', 'player-orbit-avatar') +
                            '</div>' +
                            '<div class="player-ready-dot"></div>' +
                        '</div>' +
                    '</div>';
                arm.appendChild(node);
                orbitRing.appendChild(arm);
            });
            bindOrbitImageFade(orbitRing);
            if (!orbitRing.dataset.tooltipBound) {
                orbitRing.dataset.tooltipBound = '1';
                orbitRing.addEventListener('mouseover', function (event) {
                    var node = event.target && event.target.closest ? event.target.closest('.player-node') : null;
                    if (!node || !tooltipPortal) return;
                    if (tooltipTrackNode === node) return;
                    startTooltipTracking(node);
                }, { signal: signal });
                orbitRing.addEventListener('mouseout', function (event) {
                    var node = event.target && event.target.closest ? event.target.closest('.player-node') : null;
                    if (!node || !tooltipPortal) return;
                    var related = event.relatedTarget;
                    if (related && node.contains(related)) return;
                    if (tooltipTrackNode === node) stopTooltipTracking();
                }, { signal: signal });
            }
        }

        function renderHostModalList() {
            var list = document.getElementById('host-players-list');
            if (!list || !room) return;
            isHost = !!(room.hostUserId && selfUserId && room.hostUserId === selfUserId);
            var rows = room.players.filter(function (player) {
                return player.status !== 'left';
            }).slice().sort(function (a, b) {
                if (a.userId === room.hostUserId) return -1;
                if (b.userId === room.hostUserId) return 1;
                return a.index - b.index;
            });
            if (room.bot) {
                rows = rows.concat([{
                    userId: 'bot',
                    name: room.bot.name,
                    ready: true,
                    isBot: true,
                    index: room.bot.index,
                }]);
            }
            list.innerHTML = rows.map(function (player) {
                var isRoomHost = player.userId === room.hostUserId;
                var canRemove = isHost && !isRoomHost && state === 'lobby';
                var badge = player.ready || player.isBot
                    ? '<span class="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-full whitespace-nowrap">Ready</span>'
                    : '<span class="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-white/5 border border-white/10 px-2 py-1 rounded-full whitespace-nowrap">Waiting</span>';
                var avatar = playerAvatarHtml(player, 'sm', isRoomHost ? 'ring-2 ring-primary/60' : '');
                var removeBtn = canRemove
                    ? '<button type="button" class="room-remove-player-btn ml-2 w-8 h-8 rounded-lg text-slate-500 hover:text-error hover:bg-error/10 transition-colors flex items-center justify-center shrink-0" data-user-id="' +
                        escapeHtml(player.userId) + '" title="Remove player" aria-label="Remove ' + escapeHtml(player.name) + '">' +
                        '<span class="material-symbols-outlined text-[18px]">person_remove</span></button>'
                    : '';
                return '<div class="flex items-center gap-3 px-3 py-2.5 rounded-xl ' + (isRoomHost ? 'bg-primary/5 border border-primary/10' : 'hover:bg-white/5 transition-colors') + '">' +
                    avatar +
                    '<div class="flex-1 min-w-0">' +
                        '<span class="text-sm font-semibold text-on-surface">' + escapeHtml(player.name) + '</span>' +
                        (isRoomHost ? '<span class="text-[9px] text-primary font-bold uppercase tracking-widest ml-2">Host</span>' : '') +
                        (player.isBot ? '<span class="text-[9px] text-slate-500 font-bold uppercase tracking-widest ml-2">Bot</span>' : '') +
                    '</div>' +
                    badge +
                    removeBtn +
                '</div>';
            }).join('');
            list.querySelectorAll('.room-remove-player-btn').forEach(function (button) {
                button.addEventListener('click', function () {
                    removePlayerFromRoom(button.getAttribute('data-user-id'));
                }, { signal: signal });
            });
        }

        async function removePlayerFromRoom(targetUserId) {
            if (!isHost || !roomId || !targetUserId || state !== 'lobby') return;
            try {
                await window.usertypoMultiplayer.removeRoomPlayer(roomId, targetUserId);
                if (targetUserId !== 'bot') delete invitedFriendIds[targetUserId];
                window.usertypoNotifications?.showToast('Player removed from the room.', 'person_remove');
            } catch (error) {
                window.usertypoNotifications?.showToast(error.message || 'Could not remove player', 'error');
            }
        }

        function updateLobbyButtons() {
            refreshDomRefs();
            if (!readyButton || !readyButtonLabel || !room) return;
            var readyCount = countReadyPlayers();
            var totalPlayers = countRoomParticipants();
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

        function updateAddBotOption() {
            var row = document.getElementById('invite-add-bot-row');
            var button = document.getElementById('invite-add-bot-btn');
            var label = document.getElementById('invite-add-bot-label');
            if (!row || !button) return;
            var show = !!(isHost && state === 'lobby');
            row.classList.toggle('hidden', !show);
            if (!show) return;
            var hasBot = !!room && !!room.bot;
            button.disabled = hasBot;
            button.classList.toggle('opacity-45', hasBot);
            button.classList.toggle('pointer-events-none', hasBot);
            button.classList.toggle('cursor-not-allowed', hasBot);
            if (label) label.textContent = hasBot ? 'Bot added' : 'Add a bot';
        }

        async function addBotToRoom() {
            if (!isHost || !roomId || (room && room.bot)) return;
            try {
                await window.usertypoMultiplayer.addRoomBot(roomId);
                window.usertypoNotifications?.showToast('Bot added to the room.', 'smart_toy');
            } catch (error) {
                window.usertypoNotifications?.showToast(error.message || 'Could not add bot', 'error');
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
                if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                    await window.usertypoProgression.attachToList(friends, 'user_id');
                }
                if (!friends.length) {
                    list.innerHTML = '<p class="text-xs text-slate-500 italic px-2 py-3">No friends available to invite.</p>';
                    return;
                }
                list.innerHTML = friends.map(function (friend) {
                    var invited = !!invitedFriendIds[friend.user_id];
                    return '<div class="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors">' +
                        playerAvatarHtml({
                            avatarUrl: friend.avatar_url,
                            name: friend.username || friend.display_name || 'Friend',
                            level: friend.level,
                            percentToNext: friend.percent_to_next != null ? friend.percent_to_next : friend.percentToNext,
                        }, 'sm') +
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
            if (icon) {
                icon.textContent = 'add';
                icon.classList.toggle('is-open', invitePanelOpen);
            }
            if (button) button.classList.toggle('scale-110', invitePanelOpen);
            if (invitePanelOpen) {
                renderInviteFriends();
                updateAddBotOption();
            }
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
            intentionalLeave = true;
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
                var tag = (event.target && event.target.tagName || '').toLowerCase();
                var inEditable = tag === 'input' || tag === 'textarea' || !!(event.target && event.target.isContentEditable);
                var startOpen = !!(startConfirmModal && startConfirmModal.classList.contains('opacity-100'));
                var hostOpen = !!(hostModal && hostModal.classList.contains('opacity-100'));

                // Stats view: never let Space scroll the page.
                if ((event.key === ' ' || event.key === 'Spacebar') && state === 'finished' && !inEditable) {
                    event.preventDefault();
                    return;
                }

                if (state !== 'lobby' && state !== 'finished') return;
                if (startOpen || hostOpen) return;
                if (inEditable) return;

                var leaveBtn = state === 'lobby'
                    ? document.getElementById('leave-btn')
                    : document.getElementById('stats-leave-room-btn');
                var primaryBtn = state === 'lobby'
                    ? readyButton
                    : document.getElementById('stats-return-lobby-btn');

                if (event.key === 'Tab') {
                    event.preventDefault();
                    leaveBtn?.focus();
                    return;
                }

                if (event.key !== 'Enter') return;
                event.preventDefault();
                var active = document.activeElement;
                if (leaveBtn && (active === leaveBtn || leaveBtn.contains(active))) {
                    leaveRoomAndGoFriends();
                    return;
                }
                if (state === 'lobby') {
                    readyUp();
                    return;
                }
                if (state === 'finished' && !selfReturnLobby) {
                    primaryBtn?.click();
                }
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
            var addBotBtn = document.getElementById('invite-add-bot-btn');
            if (addBotBtn) {
                addBotBtn.addEventListener('click', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    addBotToRoom();
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
                chatToggle.removeAttribute('title');
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

            var returnLobbyBtn = document.getElementById('stats-return-lobby-btn');
            if (returnLobbyBtn) {
                returnLobbyBtn.addEventListener('click', async function () {
                    if (state !== 'finished' || selfReturnLobby || !roomId) return;
                    try {
                        await window.usertypoMultiplayer.returnToLobby(roomId);
                        selfReturnLobby = true;
                        updateReturnLobbyButton();
                    } catch (error) {
                        window.usertypoNotifications?.showToast(error.message, 'error');
                    }
                }, { signal: signal });
            }
            var statsLeaveBtn = document.getElementById('stats-leave-room-btn');
            if (statsLeaveBtn) {
                statsLeaveBtn.addEventListener('click', function (event) {
                    event.preventDefault();
                    leaveRoomAndGoFriends();
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

        function showLobbyMessage() { /* lobby overlays removed */ }

        function hideLobbyMessage() { /* lobby overlays removed */ }

        function delay(ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }

        function refreshTypingDomRefs() {
            textContainer = document.getElementById('room-text-container');
            typingArea = document.getElementById('room-typing-area');
            caret = document.getElementById('caret');
            progressDisplay = document.getElementById('room-word-progress');
            progressBar = document.getElementById('room-word-progress-bar');
            wpmDisplay = document.getElementById('room-wpm-display');
            accuracyDisplay = document.getElementById('room-acc-display');
            leaderboard = document.getElementById('live-leaderboard');
            testView = document.getElementById('test-view');
            lobbyView = document.getElementById('lobby-view');
        }

        function waitForLayout() {
            return new Promise(function (resolve) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(resolve);
                });
            });
        }

        function seedProgressChrome() {
            var cfg = config || (room && room.config);
            if (!cfg) return;
            if (wpmDisplay) wpmDisplay.textContent = '0';
            if (accuracyDisplay) accuracyDisplay.textContent = '100%';
            if (cfg.mode === 'time') {
                if (progressDisplay) progressDisplay.textContent = String(cfg.amount);
                if (progressBar) progressBar.style.width = '0%';
            } else if (progressDisplay) {
                progressDisplay.innerHTML = '0<span class="text-slate-500">/</span>' + cfg.amount;
                if (progressBar) progressBar.style.width = '0%';
            }
        }

        function showTestChrome() {
            document.querySelectorAll('#test-view .typing-stat').forEach(function (element) {
                element.classList.remove('opacity-0');
            });
            seedProgressChrome();
            if (typeof window.applyRoomLiveFeedSettings === 'function') {
                window.applyRoomLiveFeedSettings();
            }
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

        function beginRaceIfAlreadyLive() {
            if (!pendingRacePayload || state === 'finished' || state === 'closed' || state === 'racing') {
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

        function syncCountdownLayout(digitVisible) {
            if (!textContainer || !typingArea) return;
            currentWordIndex = 0;
            var tapeMode = getTapeMode();
            var isTape = tapeMode === 'word' || tapeMode === 'letter';

            if (isTape) {
                // Caret stays visually fixed. Digit sits to its left by shifting the tape
                // left by the digit width when shown (no caret movement on screen).
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
                    var digitEl = document.getElementById('room-char-0-0');
                    var digitWidth = (digitVisible && digitEl) ? digitEl.getBoundingClientRect().width : 0;
                    textContainer.style.transform = 'translateX(' + (countdownTapeBaseX - digitWidth) + 'px)';
                    positionCaretAt(caret, 0, currentCharIndex);
                }
            } else {
                // Normal (non-tape) mode: unchanged.
                currentCharIndex = digitVisible ? 1 : 0;
                updateLineLayout();
                updateCaret();
            }
            if (caret) caret.style.display = 'block';
        }

        function prepareCountdownTestView() {
            refreshTypingDomRefs();
            switchToTest();
            setRoomHeaderInteractive(false);
            if (window.usertypo_settingsApi) {
                try {
                    window.usertypo_settingsApi.applyAllSettings(window.usertypo_settingsApi.loadSettings());
                } catch (_) { /* defaults */ }
            }
            progressByIndex = {};
            renderLeaderboard();
            countdownTapeLocked = false;
            countdownTapeTransform = '';
            countdownTapeBaseX = 0;

            // Same DOM path as a live 1-character word. Placeholder stays invisible so
            // caret math matches the real test, but no prompt text is shown.
            words = ['0'];
            wordOffsets = [0];
            currentWordIndex = 0;
            currentCharIndex = 0;
            if (textContainer) {
                textContainer.querySelectorAll('.word').forEach(function (element) { element.remove(); });
                textContainer.style.transform = '';
                textContainer.style.transition = '';
                appendWord('0', 0);
                var placeholder = document.getElementById('room-char-0-0');
                if (placeholder) {
                    placeholder.style.opacity = '0';
                    placeholder.setAttribute('data-countdown-ph', '1');
                }
            }
            if (caret) {
                caret.classList.add('animate-breath');
                caret.style.display = 'block';
            }
            state = 'countdown';
            showTestChrome();
        }

        async function typeCountdownDigit(digit, token) {
            var el = document.getElementById('room-char-0-0');
            if (!el || token !== countdownAnimToken) return;
            el.style.opacity = '1';
            el.textContent = digit;
            el.className = 'char text-primary drop-shadow-[0_0_5px_rgba(0,208,255,0.4)] transition-colors duration-75';
            if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(digit);
            syncCountdownLayout(true);
        }

        async function backspaceCountdownDigit(token) {
            var el = document.getElementById('room-char-0-0');
            if (!el || token !== countdownAnimToken) return;
            if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound('Backspace');
            el.style.opacity = '0';
            el.textContent = '0';
            el.className = 'char text-slate-500 transition-colors duration-75';
            syncCountdownLayout(false);
        }

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
            if (state === 'finished' || state === 'racing' || state === 'closed') return;
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
            if (!pendingRacePayload || introBusy) return;
            var payload = pendingRacePayload;
            pendingRacePayload = null;
            beginActualRace(payload);
        }

        function beginActualRace(payload) {
            if (!payload || payload.roomId !== roomId) return;
            if (state === 'racing' || state === 'finished' || state === 'closed') return;
            config = payload.config;
            words = payload.words || [];
            room.players = payload.players || room.players;
            if (payload.bot) {
                room.bot = Object.assign({}, room.bot || {}, payload.bot, { isBot: true });
            }
            if (payload.startsAt) {
                startedAt = Number(payload.startsAt);
            } else {
                startedAt = Date.now() + Math.max(0, Number(payload.startsInMs) || 0);
            }
            var self = room.players.find(function (player) { return player.userId === selfUserId; });
            selfIndex = self ? self.index : 0;
            currentWordIndex = 0;
            currentCharIndex = 0;
            completedWords = 0;
            sequence = 0;
            totalKeystrokes = 0;
            errors = 0;
            lockedAt = null;
            errorHistory = [];
            progressByIndex = {};
            lastProgressSentAt = 0;
            clearInterval(updateTimer);
            clearInterval(progressInterval);
            progressInterval = null;
            countdownAnimToken += 1;
            introBusy = false;
            countdownSequenceStarted = false;
            countdownTapeLocked = false;
            countdownTapeTransform = '';
            countdownTapeBaseX = 0;
            switchToTest();
            if (textContainer) textContainer.style.transition = '';
            renderText();
            renderLeaderboard();
            showTestChrome();
            var wait = Math.max(0, startedAt - Date.now());
            setTimeout(function () {
                state = 'racing';
                if (window.usertypo_settingsApi) {
                    try {
                        window.usertypo_settingsApi.applyAllSettings(window.usertypo_settingsApi.loadSettings());
                    } catch (_) { /* retain defaults */ }
                }
                if (typeof window.applyRoomLiveFeedSettings === 'function') {
                    window.applyRoomLiveFeedSettings();
                }
                updateLineLayout();
                updateCaret();
                showTestChrome();
                if (caret) caret.classList.remove('animate-breath');
                document.addEventListener('keydown', handleKey, { signal: signal });
                window.addEventListener('resize', function () {
                    updateLineLayout();
                    updateCaret();
                }, { signal: signal });
                updateTimer = setInterval(updateLive, 200);
                progressInterval = setInterval(function () {
                    if (state === 'racing') sendProgress(false);
                }, ROOM_PROGRESS_INTERVAL_MS);
                updateLive();
                sendProgress(false);
            }, wait);
        }

        function startRace(payload) {
            if (!payload || payload.roomId !== roomId) return;
            if (state === 'finished' || state === 'closed') return;
            pendingRacePayload = payload;
            // Backgrounded / late tabs: if the server race is already live, skip the intro.
            if (beginRaceIfAlreadyLive()) return;
            ensureCountdownSequence();
            if (!introBusy) tryBeginRaceAfterIntro();
        }

        function applyJoinOrResumeState(response) {
            if (!response || !response.room) return false;
            room = response.room;
            config = room.config;
            roomCode = room.roomCode || roomCode;
            isHost = room.hostUserId === selfUserId;
            if (response.state === 'finished') {
                applyFinishedFromResume(response);
                return true;
            }
            if (response.state === 'racing' && response.race) {
                if (state === 'finished' || state === 'closed') return true;
                countdownSequenceStarted = true;
                introBusy = false;
                beginActualRace(response.race);
                return true;
            }
            if (response.state === 'countdown') {
                if (state === 'finished' || state === 'closed' || state === 'racing') return true;
                ensureCountdownSequence();
                return true;
            }
            state = 'lobby';
            renderLobby(room);
            return true;
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

            paintLobbyPlayers();
            enrichRoomPlayerLevels().then(function (changed) {
                if (changed && room && room.roomId === roomId) paintLobbyPlayers();
            }).catch(function () { /* ignore */ });
        }

        function paintLobbyPlayers() {
            if (!room) return;
            var host = room.players.find(function (player) { return player.userId === room.hostUserId; });
            var hostWrap = document.getElementById('lobby-host');
            var hostBtn = document.getElementById('lobby-host-btn');
            var hostAvatarSlot = document.getElementById('lobby-host-avatar-slot')
                || document.querySelector('#lobby-host .lobby-host-avatar');
            if (hostAvatarSlot && host) {
                hostAvatarSlot.innerHTML = playerAvatarHtml(host, 'host', 'lobby-host-level-avatar');
                hostAvatarSlot.classList.remove('opacity-0');
            }
            if (hostWrap) hostWrap.classList.toggle('is-ready', !!(host && host.ready));
            if (host && hostBtn) {
                hostBtn.setAttribute('title', host.name || 'Host');
            }
            var guests = room.players.filter(function (player) {
                return player.userId !== room.hostUserId && player.status !== 'left';
            });
            if (room.bot) {
                guests = guests.concat([{
                    name: room.bot.name,
                    avatarUrl: '',
                    ready: true,
                    isBot: true,
                    userId: 'bot',
                    index: room.bot.index,
                }]);
            }
            layoutOrbitPlayers(guests);
            // Re-enable invite only for players who were in the room and then left.
            var nextInRoom = {};
            (room.players || []).forEach(function (player) {
                if (player.status !== 'left') nextInRoom[player.userId] = true;
            });
            Object.keys(prevInRoomIds).forEach(function (friendId) {
                if (!nextInRoom[friendId]) delete invitedFriendIds[friendId];
            });
            prevInRoomIds = nextInRoom;
            updateLobbyButtons();
            updateAddBotOption();
            if (hostModal && !hostModal.classList.contains('opacity-0')) renderHostModalList();
            if (invitePanelOpen) {
                renderInviteFriends();
                updateAddBotOption();
            }
        }

        async function enrichRoomPlayerLevels() {
            if (!room || !Array.isArray(room.players)) return false;
            if (!window.usertypoProgression || typeof window.usertypoProgression.attachToList !== 'function') {
                return false;
            }
            var needed = room.players.some(function (player) {
                return player && player.userId && !player.isBot
                    && String(player.userId).indexOf('guest_') !== 0
                    && (player.level == null || player.percentToNext == null);
            });
            if (!needed) return false;
            await window.usertypoProgression.attachToList(room.players, 'userId');
            return true;
        }

        function stopRaceTimers() {
            clearInterval(updateTimer);
            updateTimer = null;
            clearInterval(progressInterval);
            progressInterval = null;
            abortCountdownIntro();
        }

        function hideStatsView() {
            if (!statsView) return;
            statsView.classList.add('hidden', 'opacity-0');
            statsView.style.display = 'none';
            statsView.classList.remove('flex');
        }

        function switchToTest() {
            hideStatsView();
            lobbyView.classList.add('hidden');
            lobbyView.style.display = 'none';
            testView.classList.remove('hidden', 'opacity-0');
            testView.style.display = 'flex';
            testView.classList.add('flex');
        }

        function applyFinishedFromResume(response) {
            stopRaceTimers();
            if (Array.isArray(response.results) && response.results.length) {
                renderResults([
                    roomId,
                    response.finishReason || 'complete',
                    response.results,
                    response.opponentLeft ? 1 : 0,
                    'custom',
                ]);
                return;
            }
            // No stored results — at least leave the racing UI and stop progress spam.
            state = 'finished';
            finished = true;
            if (testView) {
                testView.classList.add('hidden');
                testView.style.display = 'none';
            }
            if (statsView) {
                statsView.classList.remove('hidden', 'opacity-0');
                statsView.style.display = 'flex';
                statsView.classList.add('flex');
                showStatsView();
            }
        }

        function getTapeMode() {
            return document.body.getAttribute('data-tape-mode')
                || window.usertypo_settings?.cursor?.tapeMode
                || 'off';
        }

        function appendWord(word, wordIndex) {
            var wordElement = document.createElement('div');
            wordElement.id = 'room-word-' + wordIndex;
            wordElement.className = 'word';
            word.split('').forEach(function (character, charIndex) {
                var characterElement = document.createElement('span');
                characterElement.id = 'room-char-' + wordIndex + '-' + charIndex;
                characterElement.className = 'char text-slate-500 transition-colors duration-75';
                characterElement.textContent = character;
                wordElement.appendChild(characterElement);
            });
            textContainer.appendChild(wordElement);
        }

        function renderText() {
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
            var currentWord = document.getElementById('room-word-' + currentWordIndex);
            if (!currentWord || !typingArea.clientWidth) return;
            var center = typingArea.clientWidth / 2;
            var containerRect = textContainer.getBoundingClientRect();
            if (getTapeMode() === 'word') {
                var wordRect = currentWord.getBoundingClientRect();
                textContainer.style.transform = 'translateX(' + (center - (wordRect.left - containerRect.left) - wordRect.width / 2) + 'px)';
                return;
            }
            var target = document.getElementById('room-char-' + currentWordIndex + '-' + currentCharIndex);
            var after = false;
            if (!target) {
                target = document.getElementById('room-char-' + currentWordIndex + '-' + (currentCharIndex - 1));
                after = true;
            }
            if (!target) target = currentWord;
            var targetRect = target.getBoundingClientRect();
            var targetLeft = targetRect.left - containerRect.left + (after ? targetRect.width : 0);
            textContainer.style.transform = 'translateX(' + (center - targetLeft) + 'px)';
        }

        function handleScroll() {
            var currentWord = document.getElementById('room-word-' + currentWordIndex);
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
            if (!element || !textContainer || words[wordIndex] == null) return;
            var wordElement = document.getElementById('room-word-' + wordIndex);
            if (!wordElement) return;
            var target = document.getElementById('room-char-' + wordIndex + '-' + charIndex);
            var after = false;
            if (!target) {
                target = document.getElementById('room-char-' + wordIndex + '-' + (charIndex - 1));
                after = true;
            }
            if (!target) target = wordElement;
            var targetRect = target.getBoundingClientRect();
            var containerRect = textContainer.getBoundingClientRect();
            element.style.display = 'block';
            var left = targetRect.left - containerRect.left + (after ? targetRect.width : 0);
            var top = targetRect.top - containerRect.top;
            var caretWidth = targetRect.width;
            if (!caretWidth) {
                caretWidth = Math.max(10, (parseFloat(getComputedStyle(textContainer).fontSize) || 24) * 0.55);
            }
            element.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
            element.style.width = caretWidth + 'px';
        }

        function updateCaret() {
            handleScroll();
            positionCaretAt(caret, currentWordIndex, currentCharIndex);
        }

        function paint(index, key, correct) {
            var word = words[currentWordIndex];
            var wordElement = document.getElementById('room-word-' + currentWordIndex);
            if (!wordElement) return;
            var element = document.getElementById('room-char-' + currentWordIndex + '-' + index);
            if (!element) {
                element = document.createElement('span');
                element.id = 'room-char-' + currentWordIndex + '-' + index;
                element.className = 'char extra transition-colors duration-75';
                wordElement.appendChild(element);
            }
            element.textContent = index < word.length ? word[index] : key;
            element.className = 'char transition-colors duration-75 ' + (index >= word.length ? 'extra ' : '') + (
                correct
                    ? 'text-primary drop-shadow-[0_0_5px_rgba(0,208,255,0.4)]'
                    : 'text-error drop-shadow-[0_0_7px_rgba(255,80,80,0.75)]'
            );
            if (index >= word.length) element.classList.add('extra');
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
                total += words[i].length + 1;
            }
            var activeWord = document.getElementById('room-word-' + currentWordIndex);
            if (activeWord) {
                activeWord.querySelectorAll('.char.text-primary:not(.extra)').forEach(function () {
                    total += 1;
                });
            }
            return total;
        }

        function currentMetrics() {
            var minutes = startedAt ? Math.max((Date.now() - startedAt) / 60_000, 1 / 120) : 1 / 120;
            var correct = correctChars();
            return {
                wpm: Math.max(0, Math.round((correct / 5) / minutes)),
                accuracy: totalKeystrokes
                    ? Math.max(0, Math.min(100, Math.round(((totalKeystrokes - errors) / totalKeystrokes) * 100)))
                    : 100,
                correct: correct,
            };
        }

        function sendProgress(finalPacket) {
            if (state !== 'racing' && state !== 'waiting-result' && !finalPacket) return;
            var now = Date.now();
            if (!finalPacket && lastProgressSentAt && (now - lastProgressSentAt) < ROOM_PROGRESS_INTERVAL_MS - 20) {
                return;
            }
            lastProgressSentAt = now;
            sequence += 1;
            window.usertypoMultiplayer
                .sendProgress(roomId, sequence, completedWords, totalKeystrokes, finalPacket)
                .catch(function (error) {
                    var message = String(error && error.message || '');
                    // Race already ended on the server — stop polling silently (no toast flood).
                    if (/race_not_active|no longer active|race_not_found|not in this race|player_not_active/i.test(message)) {
                        stopRaceTimers();
                        if (state === 'racing' || state === 'waiting-result') {
                            state = 'waiting-result';
                        }
                        return;
                    }
                    window.usertypoNotifications?.showToast(message, 'error');
                });
        }

        function finishWord() {
            completedWords += 1;
            currentWordIndex += 1;
            currentCharIndex = 0;
            lockedAt = null;
            errorHistory = [];
            var isFinal = config.mode === 'words' && completedWords >= config.amount;
            if (isFinal) {
                state = 'waiting-result';
                clearInterval(progressInterval);
                progressInterval = null;
                sendProgress(true);
                window.usertypoNotifications?.showToast('Finished — waiting for the remaining players.', 'check_circle');
                return;
            }
            updateCaret();
        }

        function handleKey(event) {
            if (state !== 'racing' || event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                return;
            }
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
                    if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound('Backspace');
                    updateCaret();
                } else if (currentCharIndex > 0) {
                    if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound('Backspace');
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
                if (typeof window.playErrorSound === 'function') window.playErrorSound(key);
                errors += 1;
                updateCaret();
                return;
            }
            totalKeystrokes += 1;
            if (key === ' ') {
                if (currentCharIndex === word.length) {
                    if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(key);
                    finishWord();
                } else {
                    if (typeof window.playErrorSound === 'function') window.playErrorSound(key);
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
            if (key === word[currentCharIndex]) {
                paint(currentCharIndex, key, true);
                if (typeof window.playKeystrokeSound === 'function') window.playKeystrokeSound(key);
            } else {
                if (typeof window.playErrorSound === 'function') window.playErrorSound(key);
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
                if (progressDisplay) progressDisplay.textContent = remaining;
                percentage = Math.min(100, (elapsed / config.amount) * 100);
                if (remaining === 0) {
                    state = 'waiting-result';
                    clearInterval(updateTimer);
                    clearInterval(progressInterval);
                    progressInterval = null;
                    sendProgress(true);
                }
            } else {
                if (progressDisplay) {
                    progressDisplay.innerHTML = completedWords + '<span class="text-slate-500">/</span>' + config.amount;
                }
                percentage = Math.min(100, (completedWords / config.amount) * 100);
            }
            if (progressBar) progressBar.style.width = percentage + '%';
            // Leaderboard WPMs stay packet-driven so every client shares the same order.
        }

        function renderLeaderboard() {
            if (!leaderboard || !room) return;
            var badge = document.getElementById('room-player-count-badge');
            if (badge) badge.textContent = countRoomParticipants() + ' players';
            var entries = room.players.filter(function (player) {
                return player.status !== 'left';
            }).map(function (player) {
                return Object.assign({ index: player.index, wpm: 0, isBot: false }, progressByIndex[player.index] || {}, {
                    name: player.name,
                    avatarUrl: player.avatarUrl,
                    level: player.level,
                    percentToNext: player.percentToNext,
                    userId: player.userId,
                });
            });
            if (room.bot) {
                entries.push(Object.assign({ index: room.bot.index, wpm: 0 }, progressByIndex[room.bot.index] || {}, {
                    name: room.bot.name,
                    avatarUrl: '',
                    isBot: true,
                }));
            }
            var rows = entries.sort(function (a, b) {
                return (Number(b.wpm) || 0) - (Number(a.wpm) || 0) || a.index - b.index;
            });

            var existing = {};
            Array.from(leaderboard.querySelectorAll('[data-player-index]')).forEach(function (element) {
                existing[element.getAttribute('data-player-index')] = element;
            });
            var prevOrder = Object.keys(existing).length
                ? Array.from(leaderboard.children).map(function (element) {
                    return element.getAttribute('data-player-index');
                })
                : [];
            var nextOrder = rows.map(function (row) { return String(row.index); });
            var orderChanged = prevOrder.join(',') !== nextOrder.join(',');
            var firstRects = {};
            if (orderChanged) {
                Object.keys(existing).forEach(function (key) {
                    firstRects[key] = existing[key].getBoundingClientRect();
                });
            }

            if (prevOrder.length && !orderChanged) {
                rows.forEach(function (row, index) {
                    var pill = existing[String(row.index)];
                    if (!pill) return;
                    var rank = pill.querySelector('[data-lb-rank]');
                    var wpm = pill.querySelector('[data-lb-wpm]');
                    if (rank) rank.textContent = String(index + 1);
                    if (wpm) wpm.textContent = String(Math.round(Number(row.wpm) || 0));
                    pill.classList.toggle('me', row.index === selfIndex);
                });
                return;
            }

            rebuildLeaderboardPills(rows, firstRects);
        }

        function rebuildLeaderboardPills(rows, firstRects) {
            if (!leaderboard) return;
            leaderboard.innerHTML = rows.map(function (row, index) {
                var avatar = row.isBot
                    ? botAvatarHtml('lb-avatar', 16)
                    : playerAvatarHtml(row, 'sm', 'lb-level-avatar');
                return '<div class="lb-pill player-pill' + (row.index === selfIndex ? ' me' : '') +
                    '" data-player-index="' + row.index + '">' +
                    '<span class="lb-rank text-xs font-bold text-slate-500 shrink-0" data-lb-rank>' + (index + 1) + '</span>' +
                    avatar +
                    '<span class="lb-name text-sm font-bold text-white truncate min-w-0">' + escapeHtml(row.name) +
                    (row.isBot ? ' <span class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Bot</span>' : '') +
                    '</span>' +
                    '<span class="lb-wpm text-sm font-mono text-primary shrink-0 ml-auto" data-lb-wpm>' +
                    Math.round(Number(row.wpm) || 0) + '</span>' +
                    '</div>';
            }).join('');

            if (!firstRects || !Object.keys(firstRects).length) return;
            Array.from(leaderboard.querySelectorAll('[data-player-index]')).forEach(function (element) {
                var key = element.getAttribute('data-player-index');
                var first = firstRects[key];
                if (!first) return;
                var last = element.getBoundingClientRect();
                var deltaY = first.top - last.top;
                if (!deltaY) return;
                element.style.transition = 'none';
                element.style.transform = 'translateY(' + deltaY + 'px)';
                requestAnimationFrame(function () {
                    element.style.transition = '';
                    element.style.transform = '';
                });
            });
        }

        function setRoomHeaderInteractive(enabled) {
            var headerLeft = document.getElementById('header-left');
            var headerRight = document.getElementById('header-right');
            var headerLogo = document.getElementById('header-logo-link');
            if (enabled) {
                if (headerLeft) headerLeft.classList.remove('opacity-0', 'pointer-events-none');
                if (headerRight) headerRight.classList.remove('opacity-0', 'pointer-events-none');
                if (headerLogo) headerLogo.style.pointerEvents = '';
            } else {
                if (headerLeft) headerLeft.classList.add('opacity-0', 'pointer-events-none');
                if (headerRight) headerRight.classList.add('opacity-0', 'pointer-events-none');
                if (headerLogo) headerLogo.style.pointerEvents = 'none';
            }
        }

        function initialsFromName(name) {
            var parts = String(name || 'P').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return 'P';
            if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
            return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
        }

        function buildPodiumCard(player, place) {
            var themes = {
                1: {
                    delay: '0ms', border: 'rgba(var(--theme-primary-rgb), 0.15)', boxShadow: '0 0 25px rgba(var(--theme-primary-rgb), 0.1)',
                    gradient: 'from-primary', avatarBg: 'bg-primary/20 border-primary/30 text-primary',
                    avatarShadow: 'shadow-[0_0_12px_rgba(0,208,255,0.25)]',
                    wpmClass: 'text-primary', wpmShadow: '0 0 30px rgba(var(--theme-primary-rgb), 0.4)', glow: true,
                    badge: 'bg-primary/10 border-primary/25', badgeText: 'text-primary', label: '1st', trophy: true,
                },
                2: {
                    delay: '200ms', border: 'rgba(192,192,192,0.15)', boxShadow: '',
                    gradient: 'from-slate-400', avatarBg: 'bg-slate-400/15 border-slate-400/25 text-slate-300',
                    avatarShadow: '', wpmClass: 'text-slate-200', wpmShadow: '0 0 12px rgba(255,255,255,0.15)', glow: false,
                    badge: 'bg-slate-400/10 border-slate-400/20', badgeText: 'text-slate-400', label: '2nd', trophy: false,
                },
                3: {
                    delay: '400ms', border: 'rgba(205,127,50,0.12)', boxShadow: '',
                    gradient: 'from-amber-700', avatarBg: 'bg-amber-700/10 border-amber-700/20 text-amber-600',
                    avatarShadow: '', wpmClass: 'text-amber-600', wpmShadow: '0 0 12px rgba(205,127,50,0.3)', glow: false,
                    badge: 'bg-amber-700/10 border-amber-700/20', badgeText: 'text-amber-700', label: '3rd', trophy: false,
                },
            };
            var theme = themes[place];
            var cardBorderStyle = player.isMe
                ? 'border: 1px solid rgba(var(--theme-primary-rgb), 0.2); box-shadow: 0 0 15px rgba(var(--theme-primary-rgb), 0.08);'
                : 'border:1px solid ' + theme.border + ';' + (theme.boxShadow ? ' box-shadow: ' + theme.boxShadow + ';' : '');
            var meBarHtml = player.isMe ? '<div class="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>' : '';
            var nameHtml = escapeHtml(player.name)
                + (player.isMe ? ' <span class="text-[10px] text-primary font-bold ml-1 uppercase tracking-widest">(You)</span>' : '');
            var trophyHtml = theme.trophy
                ? '<span class="material-symbols-outlined text-amber-400 text-[28px] mb-1 block" style="text-shadow: 0 0 12px rgba(251,191,36,0.5);">emoji_events</span>'
                : '';
            var glowHtml = theme.glow
                ? '<div class="absolute -inset-4 bg-primary/15 blur-2xl rounded-full" data-screenshot-glow></div>'
                : '';
            var avatarHtml = player.isBot
                ? botAvatarHtml('w-12 h-12 mx-auto mb-2', 24)
                : playerAvatarHtml(player, 'xl', 'mx-auto mb-2');

            return '<div class="flex flex-col items-center gap-3 w-[220px] anim-card" style="animation-delay: ' + theme.delay + ';">' +
                '<div class="panel-surface rounded-xl p-5 w-full text-center relative overflow-hidden" style="' + cardBorderStyle + '">' +
                '<div class="absolute left-0 top-0 w-1 h-full bg-gradient-to-b ' + theme.gradient + ' to-transparent opacity-' + (place === 1 ? '80' : '50') + '"></div>' +
                meBarHtml + trophyHtml + avatarHtml +
                '<p class="text-white font-bold text-sm mb-3">' + nameHtml + '</p>' +
                '<div class="relative inline-block mb-1">' + glowHtml +
                '<span class="text-5xl font-black ' + theme.wpmClass + ' relative z-10 leading-none tracking-tighter" style="text-shadow: ' + theme.wpmShadow + ';">' + player.wpm + '</span>' +
                '</div><p class="text-xs font-bold text-slate-500 uppercase tracking-widest">WPM</p></div>' +
                '<div class="panel-surface rounded-lg p-3 w-full"' + (place === 1 ? ' style="border:1px solid rgba(var(--theme-primary-rgb), 0.08);"' : '') + '>' +
                '<div class="grid grid-cols-3 gap-2 text-center">' +
                '<div><span class="text-[9px] font-bold text-slate-500 uppercase block">Time</span><span class="text-sm font-black text-white">' + player.timeSec + '<span class="text-[10px] text-slate-500">s</span></span></div>' +
                '<div class="border-x border-white/5"><span class="text-[9px] font-bold text-slate-500 uppercase block">Acc</span><span class="text-sm font-black text-white">' + player.acc + '<span class="text-[10px] text-slate-500">%</span></span></div>' +
                '<div><span class="text-[9px] font-bold text-slate-500 uppercase block">Con</span><span class="text-sm font-black text-white">' + player.con + '<span class="text-[10px] text-slate-500">%</span></span></div>' +
                '</div></div>' +
                '<div class="flex items-center gap-1.5 ' + theme.badge + ' border rounded-full px-3 py-1">' +
                (theme.trophy ? '<span class="material-symbols-outlined text-amber-400 text-[14px]">emoji_events</span>' : '') +
                '<span class="text-[10px] font-black ' + theme.badgeText + ' uppercase tracking-widest"' +
                (place === 1 ? ' style="text-shadow: 0 0 8px rgba(var(--theme-primary-rgb), 0.4);"' : '') + '>' + theme.label + '</span>' +
                '</div></div>';
        }

        function buildStatsListRow(player, rank) {
            var avatar = player.isBot
                ? '<div class="mr-3">' + botAvatarHtml('w-8 h-8', 16) + '</div>'
                : '<div class="mr-3">' + playerAvatarHtml(player, 'sm') + '</div>';
            if (player.isMe) {
                return '<div class="panel-surface rounded-xl px-5 py-3 flex items-center relative overflow-hidden anim-card" style="border: 1px solid rgba(var(--theme-primary-rgb), 0.2); box-shadow: 0 0 15px rgba(var(--theme-primary-rgb), 0.08);">' +
                    '<div class="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>' +
                    '<span class="text-primary font-black text-sm w-8 shrink-0">#' + rank + '</span>' +
                    avatar +
                    '<span class="text-white font-bold text-sm flex-1">' + escapeHtml(player.name) +
                    ' <span class="text-[10px] text-primary font-bold ml-1 uppercase tracking-widest">(You)</span></span>' +
                    '<span class="text-primary font-mono font-black text-lg" style="text-shadow: 0 0 8px rgba(var(--theme-primary-rgb), 0.4);">' +
                    player.wpm + ' <span class="text-xs text-slate-500 font-bold">WPM</span></span></div>';
            }
            return '<div class="panel-surface rounded-xl px-5 py-3 flex items-center hover:bg-white/5 transition-colors anim-card">' +
                '<span class="text-slate-500 font-black text-sm w-8 shrink-0">#' + rank + '</span>' +
                avatar +
                '<span class="text-slate-200 font-bold text-sm flex-1">' + escapeHtml(player.name) +
                (player.isBot ? ' <span class="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Bot</span>' : '') +
                '</span>' +
                '<span class="text-slate-300 font-mono font-bold text-base">' + player.wpm +
                ' <span class="text-xs text-slate-500">WPM</span></span></div>';
        }

        function mapResultRows(results) {
            var profileByIndex = {};
            (room.players || []).forEach(function (player) { profileByIndex[player.index] = player; });
            if (room.bot) {
                profileByIndex[room.bot.index] = {
                    name: room.bot.name,
                    avatarUrl: '',
                    isBot: true,
                };
            }
            return (results || []).map(function (row) {
                var profile = profileByIndex[row[0]] || {};
                var name = profile.name || row[2] || 'Player';
                var isBot = !!(profile.isBot || row[1] === 'bot');
                return {
                    index: row[0],
                    userId: row[1],
                    name: name,
                    initials: initialsFromName(name),
                    avatarUrl: profile.avatarUrl || '',
                    level: profile.level,
                    percentToNext: profile.percentToNext,
                    isBot: isBot,
                    wpm: Math.round(Number(row[3]) || 0),
                    acc: Math.round((Number(row[4]) || 0) * 10) / 10,
                    con: Math.round(Number(row[11]) || 0),
                    timeSec: Math.round(Number(row[12]) || 0),
                    isMe: !isBot && (row[1] === selfUserId || Number(row[0]) === selfIndex),
                };
            });
        }

        function updateReturnLobbyButton() {
            var label = document.getElementById('stats-return-lobby-label');
            var button = document.getElementById('stats-return-lobby-btn');
            if (label) {
                label.textContent = 'Back to Lobby (' + returnLobbyAgreed + '/' + returnLobbyNeeded + ')';
            }
            if (button) {
                button.classList.toggle('is-disabled', selfReturnLobby);
                button.disabled = !!selfReturnLobby;
                if (selfReturnLobby) button.setAttribute('aria-disabled', 'true');
                else button.removeAttribute('aria-disabled');
            }
        }

        function showStatsView() {
            if (typeof window.usertypo_unlockStatsScroll === 'function') {
                window.usertypo_unlockStatsScroll();
            }
            window.scrollTo(0, 0);
            setRoomHeaderInteractive(true);
            var animCards = document.querySelectorAll('#stats-view .anim-card');
            animCards.forEach(function (card) {
                card.style.animation = 'none';
                void card.offsetHeight;
                card.style.animation = '';
            });
        }

        function switchToLobbyFromStats(payload) {
            finished = false;
            selfReturnLobby = false;
            returnLobbyAgreed = 0;
            returnLobbyNeeded = 0;
            countdownAnimToken += 1;
            introBusy = false;
            countdownSequenceStarted = false;
            pendingRacePayload = null;
            state = 'lobby';
            if (payload) {
                room = payload;
                config = room.config;
                roomId = room.roomId || roomId;
                roomCode = room.roomCode || roomCode;
                isHost = room.hostUserId === selfUserId;
            }
            statsView.classList.add('hidden', 'opacity-0');
            statsView.style.display = 'none';
            statsView.classList.remove('flex');
            testView.classList.add('hidden');
            testView.style.display = 'none';
            lobbyView.classList.remove('hidden', 'opacity-0');
            lobbyView.style.display = '';
            lobbyView.classList.add('flex');
            setRoomHeaderInteractive(false);
            if (typeof window.usertypo_lockTypingScroll === 'function') {
                window.usertypo_lockTypingScroll();
            }
            renderLobby(room);
            updateReturnLobbyButton();
        }

        function renderResults(payload) {
            if (!Array.isArray(payload) || payload[0] !== roomId) return;
            finished = true;
            state = 'finished';
            selfReturnLobby = false;
            stopRaceTimers();
            abortCountdownIntro();
            countdownSequenceStarted = false;
            var players = mapResultRows(payload[2] || []);
            function paintRoomResults() {
                var top3 = players.slice(0, 3);
                var podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
                var podium = document.getElementById('stats-podium');
                var list = document.getElementById('stats-rankings-list');
                if (podium) {
                    var places = [2, 1, 3];
                    podium.innerHTML = podiumOrder.map(function (player, index) {
                        return buildPodiumCard(player, places[index]);
                    }).join('');
                }
                if (list) {
                    var me = players.find(function (player) { return player.isMe; });
                    var myInTop3 = top3.some(function (player) { return player.isMe; });
                    var rest = players.slice(3).filter(function (player) { return !player.isMe || myInTop3; });
                    var html = '';
                    if (!myInTop3 && me) {
                        var myRank = players.findIndex(function (player) { return player.isMe; }) + 1;
                        html += buildStatsListRow(me, myRank);
                        if (rest.length) html += '<div class="h-px bg-white/5 my-1"></div>';
                    }
                    html += rest.map(function (player) {
                        var rank = players.findIndex(function (item) { return item.index === player.index; }) + 1;
                        return buildStatsListRow(player, rank);
                    }).join('');
                    list.innerHTML = html;
                }
            }
            if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                window.usertypoProgression.attachToList(players, 'userId').then(paintRoomResults).catch(paintRoomResults);
            } else {
                paintRoomResults();
            }
            returnLobbyNeeded = Math.max(1, (room.players || []).filter(function (player) {
                return player.status !== 'left';
            }).length || players.length);
            returnLobbyAgreed = 0;
            updateReturnLobbyButton();
            if (payload[3]) {
                window.usertypoNotifications?.showToast('One or more players left the room during the race.', 'person_remove');
            }
            if (testView) {
                testView.classList.add('hidden');
                testView.style.display = 'none';
            }
            if (lobbyView) {
                lobbyView.classList.add('hidden');
                lobbyView.style.display = 'none';
            }
            statsView.classList.remove('hidden', 'opacity-0');
            statsView.style.display = 'flex';
            statsView.classList.add('flex');
            showStatsView();
        }

        function bindEvents() {
            listen('room-state', function (event) { renderLobby(event.detail); });
            listen('room-closed', function (event) { handleRoomClosed(event.detail); });
            listen('race-countdown', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId) return;
                if (state === 'racing' || state === 'finished' || state === 'closed') return;
                // Local 3→2→1 tape animation; ignore server tick values (no "Go").
                ensureCountdownSequence();
            });
            listen('race-start', function (event) {
                if (state === 'finished' || state === 'closed') return;
                startRace(event.detail);
            });
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState !== 'visible') return;
                beginRaceIfAlreadyLive();
            }, { signal: signal });
            listen('race-progress', function (event) {
                if (state === 'finished' || state === 'closed') return;
                var payload = event.detail;
                if (!Array.isArray(payload)) return;
                progressByIndex[payload[0]] = {
                    index: payload[0],
                    wpm: Number(payload[1]) || 0,
                    progress: payload[2],
                    completedWords: payload[4],
                };
                renderLeaderboard();
            });
            listen('race-player-left', function (event) {
                if (state === 'finished' || state === 'closed') return;
                var payload = event.detail;
                var leftIndex = Array.isArray(payload) ? Number(payload[1]) : NaN;
                if (room && Array.isArray(room.players) && Number.isFinite(leftIndex)) {
                    room.players.forEach(function (player) {
                        if (Number(player.index) === leftIndex) {
                            player.status = 'left';
                            delete invitedFriendIds[player.userId];
                            delete prevInRoomIds[player.userId];
                        }
                    });
                    delete progressByIndex[leftIndex];
                    if (state === 'racing' || state === 'waiting-result' || state === 'countdown') {
                        renderLeaderboard();
                    }
                }
                window.usertypoNotifications?.showToast('A player left the room.', 'person_remove');
            });
            listen('room-kicked', function (event) {
                var payload = event.detail || {};
                if (payload.roomId && roomId && String(payload.roomId) !== String(roomId)) return;
                intentionalLeave = true;
                state = 'closed';
                window.usertypoNotifications?.showToast('You were removed from the room.', 'person_remove');
                window.navigateTo?.('/friends');
            });
            listen('race-finished', function (event) { renderResults(event.detail); });
            listen('room-return-lobby-state', function (event) {
                var payload = event.detail;
                if (!Array.isArray(payload) || payload[0] !== roomId) return;
                returnLobbyAgreed = Number(payload[1]) || 0;
                returnLobbyNeeded = Number(payload[2]) || 0;
                var agreedIds = payload[3] || [];
                selfReturnLobby = agreedIds.indexOf(selfUserId) !== -1;
                updateReturnLobbyButton();
            });
            listen('room-returned-to-lobby', function (event) {
                var payload = event.detail;
                if (!payload || (payload.roomId && payload.roomId !== roomId)) return;
                switchToLobbyFromStats(payload);
            });
            listen('match-resumed', function (event) {
                var response = event.detail;
                if (!response || !response.room) return;
                if (response.room.roomId && roomId && response.room.roomId !== roomId) return;
                // Always sync a server-finished room — even if this tab still thinks it's racing.
                if (response.state === 'finished') {
                    applyFinishedFromResume(response);
                    return;
                }
                if (state === 'racing' || state === 'finished' || state === 'countdown') return;
                applyJoinOrResumeState(response);
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
            bindEvents();
            try {
                await window.usertypoMultiplayer.connect();
                selfUserId = window.usertypoMultiplayer.getReadyState()?.userId || '';
                if (!selfUserId) {
                    throw new Error('Could not connect to multiplayer. Refresh and try again.');
                }
                // Always resolve membership by code when present (invite link / pin join).
                if (roomCode) {
                    await ensureRoomMembership();
                }
                if (!roomId) {
                    throw new Error('Room not found. Check the Room ID and try again.');
                }
                var response = await window.usertypoMultiplayer.joinMatch(roomId);
                if (!response || response.ok === false) {
                    throw new Error((response && response.error) || 'Room not found. Check the Room ID and try again.');
                }
                applyJoinOrResumeState(response);
            } catch (error) {
                var msg = String(error && error.message || 'Room not found');
                if (/full/i.test(msg)) {
                    window.usertypoNotifications?.showToast('This room is full.', 'groups');
                } else {
                    window.usertypoNotifications?.showToast(msg, 'error');
                }
                setTimeout(function () { window.navigateTo?.('/friends'); }, 1800);
            }
        }

        function cleanup() {
            countdownAnimToken += 1;
            introBusy = false;
            countdownSequenceStarted = false;
            pendingRacePayload = null;
            stopTooltipTracking();
            clearInterval(updateTimer);
            clearInterval(progressInterval);
            progressInterval = null;
            closeHostModal();
            closeStartConfirmModal();
            setRoomHeaderInteractive(false);
            // Browser back / SPA navigation away from the room page should leave the
            // match. Explicit Leave already called leaveRace and set intentionalLeave.
            if (!intentionalLeave && roomId && state !== 'closed') {
                try {
                    window.usertypoMultiplayer?.leaveRace(roomId);
                } catch (_) { /* ignore */ }
            }
            abort.abort();
            window.toggleReady = null;
            window.showLobbyView = null;
            window.applyRoomLiveFeedSettings = null;
        }

        window.toggleReady = readyUp;
        window.showLobbyView = function () {
            if (state === 'finished') {
                document.getElementById('stats-return-lobby-btn')?.click();
                return;
            }
            window.navigateTo?.('/friends');
        };
        window.applyRoomLiveFeedSettings = function () {
            var settings = window.usertypo_settingsApi
                ? window.usertypo_settingsApi.loadSettings()
                : window.usertypo_settings;
            var lf = settings && settings.lookFeel ? settings.lookFeel : {};
            var showWpm = lf.liveWpm !== false;
            var showAcc = lf.liveAcc !== false;
            var wpmWrapper = document.getElementById('room-live-wpm-wrapper');
            var accWrapper = document.getElementById('room-live-acc-wrapper');
            var divider = document.getElementById('room-live-wpm-divider');
            if (wpmWrapper) wpmWrapper.classList.toggle('hidden', !showWpm);
            if (accWrapper) accWrapper.classList.toggle('hidden', !showAcc);
            if (divider) divider.classList.toggle('hidden', !(showWpm && showAcc));

            var timerStyle = lf.timerStyle || 'Number';
            var timerOpacity = parseFloat(lf.timerOpacity || '0.5');
            var wrapper = document.getElementById('room-timer-progress-wrapper');
            var progressText = document.getElementById('room-word-progress');
            var barContainer = document.getElementById('room-word-progress-bar-container');
            var liveStats = document.getElementById('room-live-stats');
            var racing = state === 'racing' || state === 'waiting-result';
            var showChrome = racing || state === 'countdown';
            if (wrapper) {
                if (timerStyle === 'Off') {
                    wrapper.style.visibility = 'hidden';
                } else {
                    wrapper.style.visibility = 'visible';
                    if (timerStyle === 'Bar') {
                        progressText && progressText.classList.add('hidden');
                        barContainer && barContainer.classList.remove('hidden');
                    } else {
                        progressText && progressText.classList.remove('hidden');
                        barContainer && barContainer.classList.add('hidden');
                    }
                }
                wrapper.style.opacity = showChrome ? String(timerOpacity) : '';
            }
            if (liveStats) {
                liveStats.classList.toggle('opacity-0', !showChrome);
                if (showChrome) liveStats.style.opacity = String(timerOpacity);
                else liveStats.style.opacity = '';
            }
        };
        return { init: init, cleanup: cleanup, readyUp: readyUp };
    }

    window.usertypoRoomPage = { createController: createController };
})();
