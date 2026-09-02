/**
 * Ephemeral multiplayer Socket.IO client.
 * Public API: window.usertypoMultiplayer
 */
(function () {
    'use strict';

    var nativeSetTimeout = window.setTimeout.bind(window);
    var nativeSetInterval = window.setInterval.bind(window);
    var socket = null;
    var connectPromise = null;
    var readyState = null;
    var listings = [];
    var pendingMatches = {};
    var activeRoomId = '';
    var activeRoomIsBot = false;
    var pendingLeaveRoomId = null;
    var lastAuthIdentity = null;

    function dispatch(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent('usertypo:multiplayer:' + name, { detail: detail }));
        } catch (_) { /* ignore */ }
    }

    function notify(note, options) {
        if (window.usertypoNotifications && window.usertypoNotifications.addEphemeral) {
            return window.usertypoNotifications.addEphemeral(note, options);
        }
        if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
            window.usertypoNotifications.showToast(note.title || note.body || 'Multiplayer notification', 'swords');
        }
        return null;
    }

    function navigateToRoom(roomId, roomCode) {
        if (!roomId) return;
        var params = { room: roomId };
        if (roomCode) params.code = String(roomCode);
        var url = '/room?' + new URLSearchParams(params).toString();
        if (typeof window.navigateTo === 'function') window.navigateTo(url);
        else window.location.href = url;
    }

    function navigateToMatch(roomId) {
        if (!roomId) return;
        var url = '/dual?' + new URLSearchParams({ room: roomId }).toString();
        if (typeof window.navigateTo === 'function') window.navigateTo(url);
        else window.location.href = url;
    }

    function friendlyError(code) {
        var messages = {
            unauthorized: 'Sign in to challenge friends.',
            friend_offline: 'That friend is no longer online.',
            not_friends: 'You can only challenge friends.',
            blocked: 'This player has blocked you.',
            invite_not_found: 'That dual request has expired.',
            listing_unavailable: 'That dual is no longer available.',
            already_searching: 'You cannot create a dual while already looking for a dual.',
            own_listing: 'You cannot join your own dual.',
            already_in_match: 'You are already in a match.',
            room_not_found: 'Room not found. Check the Room ID and try again.',
            room_full: 'This room is full.',
            race_not_active: 'This race is no longer active.',
            race_not_found: 'Race not found.',
            early_progress: 'Race has not started yet.',
            player_not_active: 'You are not in this race.',
            room_unavailable: 'Room not found. Check the Room ID and try again.',
            not_enough_ready: 'At least 3 players must be ready to start.',
            players_not_ready: 'Some players are still not ready.',
            already_in_room: 'That player is already in the room.',
            forbidden: 'You do not have permission to do that.',
            server_capacity: 'The multiplayer server is currently full.',
            rate_limited: 'Too many multiplayer actions. Please wait a moment.',
        };
        return messages[code] || String(code || 'Multiplayer request failed.');
    }

    function emitAck(event, payload, timeoutMs) {
        return ensureConnected().then(function (activeSocket) {
            return new Promise(function (resolve, reject) {
                var settled = false;
                var timeout = nativeSetTimeout(function () {
                    if (settled) return;
                    settled = true;
                    reject(new Error('Multiplayer server did not respond.'));
                }, timeoutMs || 8000);
                activeSocket.emit(event, payload, function (response) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (!response || response.ok === false) {
                        reject(new Error(friendlyError(response && response.error)));
                        return;
                    }
                    resolve(response);
                });
            });
        });
    }

    function bindSocketEvents(activeSocket) {
        activeSocket.on('connect', function () {
            dispatch('connected', { socketId: activeSocket.id });
        });
        activeSocket.on('disconnect', function (reason) {
            readyState = null;
            dispatch('disconnected', { reason: reason });
        });
        activeSocket.on('connect_error', function (error) {
            dispatch('error', { code: 'connection_failed', message: error && error.message });
        });
        activeSocket.on('multiplayer:ready', function (state) {
            readyState = state;
            listings = Array.isArray(state.listings) ? state.listings : [];
            dispatch('ready', state);
            dispatch('listings', listings.slice());
            if (activeRoomId) {
                activeSocket.emit('match:resume', activeRoomId, function (response) {
                    if (!response || response.ok === false) {
                        if (response && response.error === 'room_unavailable') activeRoomId = '';
                        return;
                    }
                    dispatch('match-resumed', response);
                    // Replay finished results after reconnect so dual/room stats can paint.
                    if (response.state === 'finished' && Array.isArray(response.results)) {
                        dispatch('race-finished', [
                            activeRoomId,
                            response.finishReason || 'complete',
                            response.results,
                            response.opponentLeft ? 1 : 0,
                            (response.room && (response.room.reason || response.room.type)) || '',
                        ]);
                    }
                    // Only replay live race-start when the server says the race is still active.
                    // Never invent a new race UI after the room has finished.
                    if (response.race && response.state === 'racing') {
                        dispatch('race-start', response.race);
                    } else if (response.state === 'countdown' && response.countdown != null) {
                        dispatch('race-countdown', [
                            activeRoomId,
                            response.countdown,
                            response.countdownEndsAt || null,
                        ]);
                    }
                });
                if (pendingLeaveRoomId) {
                    var leaveTarget = pendingLeaveRoomId;
                    pendingLeaveRoomId = null;
                    activeSocket.emit('race:leave', leaveTarget, function () { /* best-effort */ });
                }
            } else if (pendingLeaveRoomId) {
                var leaveOnly = pendingLeaveRoomId;
                pendingLeaveRoomId = null;
                activeSocket.emit('race:leave', leaveOnly, function () { /* best-effort */ });
            }
        });
        activeSocket.on('multiplayer:error', function (payload) {
            dispatch('error', { code: payload && payload[0] || 'server_error' });
        });
        activeSocket.on('multiplayer:presence', function (payload) {
            dispatch('presence', payload);
        });
        activeSocket.on('duel:listings', function (rows) {
            listings = Array.isArray(rows) ? rows : [];
            dispatch('listings', listings.slice());
        });
        activeSocket.on('duel:incoming', function (invite) {
            notify({
                id: 'duel-invite:' + invite.inviteId,
                type: 'duel_request',
                title: invite.fromName + ' challenged you to a dual',
                body: describeConfig(invite.config),
                data: { inviteId: invite.inviteId },
                _actions: [
                    {
                        label: 'Accept',
                        run: function () { return respondToChallenge(invite.inviteId, true); },
                    },
                    {
                        label: 'Reject',
                        run: function () { return respondToChallenge(invite.inviteId, false); },
                    },
                ],
            });
            dispatch('incoming', invite);
        });
        activeSocket.on('duel:ready', function (match) {
            pendingMatches[match.roomId] = match;
            var isBot = match.reason === 'bot';
            var autoJoinBot = isBot
                && window.DualMatch
                && typeof window.DualMatch.consumeAutoJoinBotMatch === 'function'
                && window.DualMatch.consumeAutoJoinBotMatch();
            dispatch('match-ready', match);
            if (autoJoinBot) {
                navigateToMatch(match.roomId);
                return;
            }
            notify({
                id: 'duel-ready:' + match.roomId,
                type: 'duel_ready',
                title: isBot ? 'No player found — bot match ready' : 'Dual accepted — match ready',
                body: (isBot ? 'You will race against TypeBot. ' : '') + 'Click Join when you are ready.',
                data: { roomId: match.roomId },
                _actions: [{
                    label: 'Join',
                    resolve: false,
                    run: function () { navigateToMatch(match.roomId); },
                }],
            });
        });
        activeSocket.on('duel:search-timeout', function (payload) {
            dispatch('search-timeout', payload || {});
        });
        activeSocket.on('duel:rejected', function (payload) {
            notify({
                id: 'duel-rejected:' + payload[0],
                type: 'duel_rejected',
                title: (payload[2] || 'Your friend') + ' rejected your dual request',
                body: 'You can send another challenge whenever they are ready.',
            });
            dispatch('rejected', payload);
        });
        activeSocket.on('duel:expired', function (payload) {
            notify({
                id: 'duel-expired:' + payload[0],
                type: 'duel_notice',
                title: 'Dual request expired',
                body: 'The request was not accepted while both players were online.',
            });
            dispatch('expired', payload);
        });
        activeSocket.on('room:invite', function (invite) {
            if (!invite || !invite.roomId) return;
            notify({
                id: 'room-invite:' + invite.roomId + ':' + (invite.fromUserId || ''),
                type: 'room_invite',
                title: (invite.fromName || 'A friend') + ' invited you to a room',
                body: (invite.roomName || 'Private Room') + ' · Room ' + (invite.roomCode || ''),
                data: { roomId: invite.roomId, roomCode: invite.roomCode },
                _actions: [{
                    label: 'Join',
                    resolve: false,
                    run: function () {
                        return joinRoomCode(invite.roomCode).then(function (response) {
                            navigateToRoom(response.roomId, invite.roomCode);
                        });
                    },
                }],
            });
            dispatch('room-invite', invite);
        });
        activeSocket.on('room:host-ready', function (payload) {
            if (!payload || !payload.roomId) return;
            if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast(
                    'The host is ready — ' + (payload.hostName || 'The host') + ' is waiting to start.',
                    'flag'
                );
            }
            dispatch('room-host-ready', payload);
        });
        activeSocket.on('room:closed', function (payload) {
            var roomId = Array.isArray(payload) ? payload[0] : '';
            var reason = Array.isArray(payload) ? payload[1] : '';
            if (activeRoomId && roomId && activeRoomId === String(roomId)) activeRoomId = '';
            var titles = {
                'host-left': 'The host left — room closed',
                inactivity: 'Room closed due to inactivity',
                empty: 'Room closed',
                closed: 'Room closed',
            };
            notify({
                id: 'room-closed:' + roomId,
                type: 'room_notice',
                title: titles[reason] || titles.closed,
                body: 'You were returned to the friends page.',
            });
            dispatch('room-closed', payload);
        });
        activeSocket.on('room:kicked', function (payload) {
            var kickedRoomId = payload && payload.roomId ? String(payload.roomId) : '';
            if (activeRoomId && kickedRoomId && activeRoomId === kickedRoomId) activeRoomId = '';
            dispatch('room-kicked', payload || {});
        });
        [
            'race:joined', 'race:countdown', 'race:start', 'race:progress', 'race:cursor',
            'race:finished', 'race:player-left', 'race:invalid', 'race:rematch-state',
            'race:rematch-start', 'room:state',
            'room:return-lobby-state', 'room:returned-to-lobby',
        ].forEach(function (eventName) {
            activeSocket.on(eventName, function (payload) {
                if (eventName === 'race:finished') {
                    var finishedType = Array.isArray(payload) ? payload[4] : '';
                    // Keep dual room membership for rematch; rooms stay for return-to-lobby.
                    if (finishedType !== 'custom'
                        && finishedType !== 'friend'
                        && finishedType !== 'public'
                        && finishedType !== 'bot') {
                        activeRoomId = '';
                    }
                }
                if (eventName === 'room:returned-to-lobby' && payload && payload.roomId) {
                    activeRoomId = String(payload.roomId);
                }
                dispatch(eventName.replace(/:/g, '-'), payload);
            });
        });
    }

    function getOrCreateGuestId() {
        var key = 'usertypo:guest-id';
        try {
            var existing = localStorage.getItem(key);
            if (existing && /^guest_[a-z0-9-]{8,80}$/i.test(existing)) return existing;
        } catch (_) { /* ignore */ }
        var id = 'guest_' + (window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : (Date.now().toString(16) + Math.random().toString(16).slice(2, 10)));
        try { localStorage.setItem(key, id); } catch (_) { /* ignore */ }
        return id;
    }

    function usesCfTransport() {
        var cfg = window.USERTYPO_CONFIG || {};
        var mp = cfg.multiplayer || {};
        if (mp.transport === 'cf') return true;
        if (window.usertypoMultiplayerCf && window.usertypoMultiplayerCf.isCloudflareUrl(mp.url)) return true;
        return false;
    }

    function ensureCfTransport() {
        if (window.usertypoMultiplayerCf) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = '/js/api/multiplayer-cf-transport.js?v=3';
            script.async = true;
            script.onload = function () {
                if (window.usertypoMultiplayerCf) resolve();
                else reject(new Error('Cloudflare multiplayer transport is not loaded.'));
            };
            script.onerror = function () {
                reject(new Error('Cloudflare multiplayer transport is not loaded.'));
            };
            document.head.appendChild(script);
        });
    }

    function socketIoClientSrc() {
        var cfg = window.USERTYPO_CONFIG || {};
        var base = String(
            (cfg.multiplayer && cfg.multiplayer.url)
            || (cfg.backend && cfg.backend.url)
            || ''
        ).replace(/\/+$/, '');
        return (base || '') + '/socket.io/socket.io.js';
    }

    function ensureSocketIoClient() {
        if (window.io) return Promise.resolve();
        var candidates = [socketIoClientSrc(), '/js/socket.io.min.js', '/js/vendor/socket.io.min.js'];
        var unique = [];
        candidates.forEach(function (src) {
            if (src && unique.indexOf(src) === -1) unique.push(src);
        });
        return unique.reduce(function (chain, src) {
            return chain.catch(function () {
                return new Promise(function (resolve, reject) {
                    var script = document.createElement('script');
                    script.src = src;
                    script.async = true;
                    script.onload = function () {
                        if (window.io) resolve();
                        else reject(new Error('Socket.IO client is not loaded.'));
                    };
                    script.onerror = function () {
                        reject(new Error('Socket.IO client is not loaded.'));
                    };
                    document.head.appendChild(script);
                });
            });
        }, Promise.reject(new Error('start')));
    }

    async function ensureConnected() {
        if (socket && socket.connected && readyState) return socket;
        if (connectPromise) return connectPromise;
        connectPromise = (async function () {
            if (!window.usertypoAuth) throw new Error('Authentication is not loaded.');
            await window.usertypoAuth.ready();
            if (!socket) {
                var authFn = function (callback) {
                    var state = window.usertypoAuth.getState();
                    if (state && state.isSignedIn && window.Clerk && window.Clerk.session) {
                        window.Clerk.session.getToken()
                            .then(function (token) { callback({ token: token }); })
                            .catch(function () { callback({ guestId: getOrCreateGuestId() }); });
                        return;
                    }
                    callback({ guestId: getOrCreateGuestId() });
                };
                if (usesCfTransport()) {
                    await ensureCfTransport();
                    socket = window.usertypoMultiplayerCf.createSocket({ auth: authFn });
                } else {
                    await ensureSocketIoClient();
                    if (!window.io) throw new Error('Socket.IO client is not loaded.');
                    var url = window.USERTYPO_CONFIG
                        && window.USERTYPO_CONFIG.multiplayer
                        && window.USERTYPO_CONFIG.multiplayer.url;
                    socket = window.io(url || undefined, {
                        autoConnect: false,
                        transports: ['websocket', 'polling'],
                        reconnection: true,
                        reconnectionAttempts: Infinity,
                        reconnectionDelay: 500,
                        reconnectionDelayMax: 4000,
                        auth: authFn,
                    });
                }
                bindSocketEvents(socket);
            }
            if (!socket.active) await socket.connect();
            if (!readyState) {
                await new Promise(function (resolve, reject) {
                    var timeout = nativeSetTimeout(function () {
                        reject(new Error('Could not connect to the multiplayer server.'));
                    }, 20_000);
                    socket.once('multiplayer:ready', function () {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            }
            return socket;
        })();
        try {
            return await connectPromise;
        } finally {
            connectPromise = null;
        }
    }

    function describeConfig(config) {
        config = config || {};
        function flagOn(value) {
            return value === true || value === 1 || value === '1';
        }
        return [
            config.amount + ' seconds',
            flagOn(config.punct) ? 'punctuation' : '',
            flagOn(config.nums) ? 'numbers' : '',
        ].filter(Boolean).join(' · ');
    }

    function sendChallenge(toUserId, config) {
        return emitAck('duel:challenge', { toUserId: toUserId, config: config }).catch(function (error) {
            var message = String(error && error.message || '');
            if (!/already in a match/i.test(message)) throw error;
            return leaveRace('').then(function () {
                return emitAck('duel:challenge', { toUserId: toUserId, config: config });
            });
        });
    }

    function respondToChallenge(inviteId, accepted) {
        return emitAck('duel:respond', [inviteId, accepted ? 1 : 0]);
    }

    function cancelChallenge(inviteId) {
        return emitAck('duel:cancel-invite', String(inviteId || ''));
    }

    function createPublicDuel(config) {
        return emitAck('duel:create', config).catch(function (error) {
            var message = String(error && error.message || '');
            if (!/already in a match/i.test(message)) throw error;
            return leaveRace('').then(function () {
                return emitAck('duel:create', config);
            });
        });
    }

    function cancelPublicDuel() {
        return emitAck('duel:cancel', null);
    }

    function extendPublicDuelSearch(listingId) {
        return emitAck('duel:extend-search', String(listingId || ''));
    }

    function playBotFromListing(listingId) {
        return emitAck('duel:play-bot', String(listingId || ''));
    }

    function requestRematch(roomId) {
        return emitAck('race:rematch', String(roomId || ''));
    }

    function loadListings() {
        return emitAck('duel:list', null).then(function (response) {
            listings = response.listings || [];
            return listings.slice();
        });
    }

    function joinListing(listingId) {
        return emitAck('duel:join-listing', listingId).catch(function (error) {
            var message = String(error && error.message || '');
            if (!/already in a match/i.test(message)) throw error;
            return leaveRace('').then(function () {
                return emitAck('duel:join-listing', listingId);
            });
        });
    }

    function joinMatch(roomId) {
        return emitAck('match:join', roomId).then(function (response) {
            activeRoomId = String(roomId || '');
            var room = response && response.room;
            activeRoomIsBot = !!(room && (
                room.reason === 'bot'
                || room.type === 'bot'
            ));
            return response;
        });
    }

    function sendProgress(roomId, sequence, completedWords, totalKeystrokes, finalPacket, finalStats) {
        // Bot duals: allow only the final settle packet (no live progress spam).
        if (activeRoomIsBot && !finalPacket) {
            return Promise.resolve({ ok: true, skipped: true });
        }
        return emitAck('race:progress', [
            roomId,
            sequence,
            completedWords,
            totalKeystrokes,
            finalPacket ? 1 : 0,
            finalStats || null,
        ], 5000);
    }

    function sendCursorState(roomId, wpm, wordIndex, charIndex) {
        if (activeRoomIsBot) {
            return Promise.resolve({ ok: true, skipped: true });
        }
        if (!socket || !socket.connected) {
            return Promise.resolve({ ok: false, offline: true });
        }
        var targetRoom = String(roomId || activeRoomId || '');
        if (!targetRoom) {
            return Promise.resolve({ ok: false, missingRoom: true });
        }
        socket.volatile.emit('race:cursor', [
            targetRoom,
            Math.max(0, Math.round(Number(wpm) || 0)),
            Math.max(0, Math.floor(Number(wordIndex) || 0)),
            Math.max(0, Math.floor(Number(charIndex) || 0)),
        ]);
        return Promise.resolve({ ok: true });
    }

    function leaveRace(roomId) {
        activeRoomId = '';
        activeRoomIsBot = false;
        if (!socket || !socket.connected) {
            // Queue so reconnect can clear server membership (avoids "already in a match").
            pendingLeaveRoomId = roomId || pendingLeaveRoomId || '';
            return Promise.resolve({ ok: true, queued: true });
        }
        pendingLeaveRoomId = null;
        return emitAck('race:leave', roomId || '', 2000).catch(function () {
            return { ok: true };
        });
    }

    function createRoom(options) {
        return emitAck('room:create', options).catch(function (error) {
            var message = String(error && error.message || '');
            if (!/already in a match/i.test(message)) throw error;
            // Recover from stale membership (e.g. browser back without leave).
            return leaveRace('').then(function () {
                return emitAck('room:create', options);
            });
        });
    }

    function joinRoomCode(code) {
        return emitAck('room:join-code', String(code || '')).catch(function (error) {
            var message = String(error && error.message || '');
            if (!/already in a match/i.test(message)) throw error;
            return leaveRace('').then(function () {
                return emitAck('room:join-code', String(code || ''));
            });
        });
    }

    function setRoomReady(roomId) {
        return emitAck('room:ready', roomId);
    }

    function updateRoomConfig(roomId, config) {
        return emitAck('room:update-config', { roomId: roomId, config: config });
    }

    function returnToLobby(roomId) {
        return emitAck('room:return-lobby', roomId);
    }

    function addRoomBot(roomId) {
        return emitAck('room:add-bot', roomId);
    }

    function startRoom(roomId, force) {
        return emitAck('room:start', { roomId: roomId, force: !!force });
    }

    function inviteToRoom(roomId, toUserId) {
        return emitAck('room:invite', { roomId: roomId, toUserId: toUserId });
    }

    function removeRoomPlayer(roomId, targetUserId) {
        return emitAck('room:remove-player', { roomId: roomId, targetUserId: targetUserId });
    }

    if (window.usertypoAuth) {
        window.usertypoAuth.onChange(function (authState) {
            var identity = !authState || !authState.isLoaded
                ? null
                : (authState.isSignedIn && authState.user && authState.user.id
                    ? String(authState.user.id)
                    : 'guest');
            // Clerk fires on token refresh — only tear down when identity actually changes.
            if (!identity || identity === lastAuthIdentity) return;
            lastAuthIdentity = identity;
            if (activeRoomId) {
                pendingLeaveRoomId = pendingLeaveRoomId || activeRoomId;
                activeRoomId = '';
            }
            if (socket) {
                socket.disconnect();
                socket = null;
                readyState = null;
                pendingMatches = {};
            }
            ensureConnected().catch(function (error) {
                console.warn('[multiplayer] connect failed:', error && error.message);
            });
        });
        window.usertypoAuth.ready().then(function () {
            return ensureConnected();
        }).catch(function () { /* auth unavailable */ });
    }

    window.usertypoMultiplayer = {
        connect: ensureConnected,
        sendChallenge: sendChallenge,
        cancelChallenge: cancelChallenge,
        respondToChallenge: respondToChallenge,
        createPublicDuel: createPublicDuel,
        cancelPublicDuel: cancelPublicDuel,
        extendPublicDuelSearch: extendPublicDuelSearch,
        playBotFromListing: playBotFromListing,
        requestRematch: requestRematch,
        loadListings: loadListings,
        joinListing: joinListing,
        joinMatch: joinMatch,
        sendProgress: sendProgress,
        sendCursorState: sendCursorState,
        leaveRace: leaveRace,
        createRoom: createRoom,
        joinRoomCode: joinRoomCode,
        setRoomReady: setRoomReady,
        updateRoomConfig: updateRoomConfig,
        returnToLobby: returnToLobby,
        addRoomBot: addRoomBot,
        startRoom: startRoom,
        inviteToRoom: inviteToRoom,
        removeRoomPlayer: removeRoomPlayer,
        navigateToRoom: navigateToRoom,
        navigateToMatch: navigateToMatch,
        describeConfig: describeConfig,
        getListings: function () { return listings.slice(); },
        getPendingMatch: function (roomId) { return pendingMatches[roomId] || null; },
        getSocket: function () { return socket; },
        getReadyState: function () { return readyState; },
    };
})();
