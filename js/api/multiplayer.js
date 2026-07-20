/**
 * Ephemeral multiplayer Socket.IO client.
 * Public API: window.usertypoMultiplayer
 */
(function () {
    'use strict';

    var nativeSetTimeout = window.setTimeout.bind(window);
    var socket = null;
    var connectPromise = null;
    var readyState = null;
    var listings = [];
    var pendingMatches = {};
    var activeRoomId = '';

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

    function navigateToMatch(roomId) {
        if (!roomId) return;
        var url = '/dual?' + new URLSearchParams({ room: roomId }).toString();
        if (typeof window.navigateTo === 'function') window.navigateTo(url);
        else window.location.href = url;
    }

    function friendlyError(code) {
        var messages = {
            unauthorized: 'Sign in to use multiplayer.',
            friend_offline: 'That friend is no longer online.',
            not_friends: 'You can only challenge friends.',
            invite_not_found: 'That dual request has expired.',
            listing_unavailable: 'That dual is no longer available.',
            already_searching: 'You cannot create a dual while already looking for a dual.',
            own_listing: 'You cannot join your own dual.',
            already_in_match: 'You are already in a match.',
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
                    if (response.countdown != null) {
                        dispatch('race-countdown', [activeRoomId, response.countdown]);
                    }
                });
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
            dispatch('match-ready', match);
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
        [
            'race:joined', 'race:countdown', 'race:start', 'race:progress',
            'race:finished', 'race:player-left', 'race:invalid', 'room:state',
        ].forEach(function (eventName) {
            activeSocket.on(eventName, function (payload) {
                if (eventName === 'race:finished') activeRoomId = '';
                dispatch(eventName.replace(':', '-'), payload);
            });
        });
    }

    async function ensureConnected() {
        if (socket && socket.connected && readyState) return socket;
        if (connectPromise) return connectPromise;
        connectPromise = (async function () {
            if (!window.io) throw new Error('Socket.IO client is not loaded.');
            if (!window.usertypoAuth) throw new Error('Authentication is not loaded.');
            await window.usertypoAuth.ready();
            var state = window.usertypoAuth.getState();
            if (!state.isSignedIn || !window.Clerk || !window.Clerk.session) {
                throw new Error('Sign in to use multiplayer.');
            }
            if (!socket) {
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
                    auth: function (callback) {
                        window.Clerk.session.getToken()
                            .then(function (token) { callback({ token: token }); })
                            .catch(function () { callback({ token: '' }); });
                    },
                });
                bindSocketEvents(socket);
            }
            if (!socket.active) socket.connect();
            await new Promise(function (resolve, reject) {
                var timeout = nativeSetTimeout(function () {
                    reject(new Error('Could not connect to the multiplayer server.'));
                }, 20_000);
                socket.once('multiplayer:ready', function () {
                    clearTimeout(timeout);
                    resolve();
                });
            });
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
        return [
            config.amount + ' ' + (config.mode === 'words' ? 'words' : 'seconds'),
            config.lang || 'english',
            config.punct ? 'punctuation' : '',
            config.nums ? 'numbers' : '',
        ].filter(Boolean).join(' · ');
    }

    function sendChallenge(toUserId, config) {
        return emitAck('duel:challenge', { toUserId: toUserId, config: config });
    }

    function respondToChallenge(inviteId, accepted) {
        return emitAck('duel:respond', [inviteId, accepted ? 1 : 0]);
    }

    function cancelChallenge(inviteId) {
        return emitAck('duel:cancel-invite', String(inviteId || ''));
    }

    function createPublicDuel(config) {
        return emitAck('duel:create', config);
    }

    function cancelPublicDuel() {
        return emitAck('duel:cancel', null);
    }

    function loadListings() {
        return emitAck('duel:list', null).then(function (response) {
            listings = response.listings || [];
            return listings.slice();
        });
    }

    function joinListing(listingId) {
        return emitAck('duel:join-listing', listingId);
    }

    function joinMatch(roomId) {
        return emitAck('match:join', roomId).then(function (response) {
            activeRoomId = String(roomId || '');
            return response;
        });
    }

    function sendProgress(roomId, sequence, completedWords, totalKeystrokes, finalPacket) {
        return emitAck('race:progress', [
            roomId,
            sequence,
            completedWords,
            totalKeystrokes,
            finalPacket ? 1 : 0,
        ], 5000);
    }

    function leaveRace(roomId) {
        activeRoomId = '';
        if (!socket || !socket.connected) return Promise.resolve({ ok: true });
        return emitAck('race:leave', roomId, 2000);
    }

    function createRoom(options) {
        return emitAck('room:create', options);
    }

    function joinRoomCode(code) {
        return emitAck('room:join-code', String(code || ''));
    }

    function setRoomReady(roomId) {
        return emitAck('room:ready', roomId);
    }

    function startRoom(roomId) {
        return emitAck('room:start', roomId);
    }

    if (window.usertypoAuth) {
        window.usertypoAuth.onChange(function (state) {
            if (state && state.isSignedIn && state.user) {
                ensureConnected().catch(function (error) {
                    console.warn('[multiplayer] connect failed:', error && error.message);
                });
            } else if (socket) {
                socket.disconnect();
                socket = null;
                readyState = null;
                pendingMatches = {};
                activeRoomId = '';
            }
        });
        window.usertypoAuth.ready().then(function () {
            var state = window.usertypoAuth.getState();
            if (state && state.isSignedIn) return ensureConnected();
        }).catch(function () { /* guest or unavailable */ });
    }

    window.usertypoMultiplayer = {
        connect: ensureConnected,
        sendChallenge: sendChallenge,
        cancelChallenge: cancelChallenge,
        respondToChallenge: respondToChallenge,
        createPublicDuel: createPublicDuel,
        cancelPublicDuel: cancelPublicDuel,
        loadListings: loadListings,
        joinListing: joinListing,
        joinMatch: joinMatch,
        sendProgress: sendProgress,
        leaveRace: leaveRace,
        createRoom: createRoom,
        joinRoomCode: joinRoomCode,
        setRoomReady: setRoomReady,
        startRoom: startRoom,
        navigateToMatch: navigateToMatch,
        describeConfig: describeConfig,
        getListings: function () { return listings.slice(); },
        getPendingMatch: function (roomId) { return pendingMatches[roomId] || null; },
        getSocket: function () { return socket; },
        getReadyState: function () { return readyState; },
    };
})();
