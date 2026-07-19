'use strict';

const crypto = require('crypto');
const { Server } = require('socket.io');
const { LIMITS, normalizeConfig, configKey, clampInteger } = require('./config');
const { createPrompt } = require('./prompt');
const { createAuthServices } = require('./auth');

function shortId(bytes = 9) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function safeAck(ack, value) {
    if (typeof ack === 'function') ack(value);
}

function createMultiplayerServer(httpServer, options) {
    const root = options.root;
    const env = options.env || process.env;
    const logger = options.logger || console;
    const allowedOrigins = String(env.ALLOWED_ORIGINS || env.RENDER_EXTERNAL_URL || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins.length ? allowedOrigins : true,
            credentials: true,
        },
        transports: ['websocket', 'polling'],
        perMessageDeflate: {
            threshold: 1024,
        },
        maxHttpBufferSize: LIMITS.maxPayloadBytes,
        pingInterval: 20_000,
        pingTimeout: 15_000,
    });
    const auth = createAuthServices(env, logger);
    const onlineUsers = new Map();
    const profiles = new Map();
    const invites = new Map();
    const listings = new Map();
    const rooms = new Map();
    const userToRoom = new Map();
    const disconnectTimers = new Map();
    const maxBurstWpm = clampInteger(env.MAX_BURST_WPM, 160, 500, 280);
    const maxSustainedWpm = clampInteger(env.MAX_SUSTAINED_WPM, 120, 400, 220);

    io.use(auth.authenticateSocket);

    function userChannel(userId) {
        return 'user:' + userId;
    }

    function roomChannel(roomId) {
        return 'race:' + roomId;
    }

    function emitToUser(userId, event, payload) {
        io.to(userChannel(userId)).emit(event, payload);
    }

    function isOnline(userId) {
        const sockets = onlineUsers.get(userId);
        return !!(sockets && sockets.size);
    }

    function serializeConfig(config) {
        return [config.mode, config.amount, config.lang, config.punct ? 1 : 0, config.nums ? 1 : 0];
    }

    function serializeListings() {
        return Array.from(listings.values())
            .filter((listing) => listing.status === 'waiting')
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((listing) => [
                listing.id,
                listing.ownerName,
                serializeConfig(listing.config),
                listing.createdAt,
            ]);
    }

    function broadcastListings() {
        io.emit('duel:listings', serializeListings());
    }

    function cancelTimer(holder, key) {
        if (holder && holder[key]) clearTimeout(holder[key]);
        if (holder) holder[key] = null;
    }

    function createPlayer(userId, index, profile) {
        return {
            userId,
            index,
            name: profile && profile.name || 'Player',
            avatarUrl: profile && profile.avatarUrl || '',
            joined: false,
            ready: false,
            socketId: null,
            status: 'waiting',
            sequence: 0,
            completedWords: 0,
            correctChars: 0,
            totalKeystrokes: 0,
            wpm: 0,
            accuracy: 100,
            lastSnapshotAt: 0,
            anomalyStrikes: 0,
            finishedAt: null,
            leftMidGame: false,
            snapshots: [],
        };
    }

    function createRoom(type, config, allowedUserIds, extra) {
        if (rooms.size >= LIMITS.maxActiveRooms) throw new Error('server_capacity');
        const id = shortId();
        const prompt = createPrompt(root, config);
        const players = new Map();
        allowedUserIds.forEach((userId, index) => {
            players.set(userId, createPlayer(userId, index, profiles.get(userId)));
        });
        const room = {
            id,
            type,
            config,
            configKey: configKey(config),
            prompt,
            players,
            allowedUserIds: new Set(allowedUserIds),
            hostUserId: extra && extra.hostUserId || allowedUserIds[0],
            maxPlayers: extra && extra.maxPlayers || allowedUserIds.length,
            roomName: extra && extra.roomName || '',
            roomCode: extra && extra.roomCode || '',
            bot: extra && extra.bot || null,
            state: 'waiting',
            createdAt: Date.now(),
            startsAt: null,
            countdownEndsAt: null,
            countdownTimer: null,
            joinTimer: null,
            raceTimer: null,
            botTimer: null,
            disposeTimer: null,
            opponentLeft: false,
        };
        rooms.set(id, room);
        allowedUserIds.forEach((userId) => userToRoom.set(userId, id));
        if (type !== 'custom') {
            room.joinTimer = setTimeout(() => {
                if (room.state !== 'waiting') return;
                room.allowedUserIds.forEach((userId) => emitToUser(userId, 'duel:expired', [room.id, 'room']));
                disposeRoom(room.id);
            }, LIMITS.joinTtlMs);
        }
        return room;
    }

    function publicRoomPayload(room, reason) {
        return {
            roomId: room.id,
            reason: reason || room.type,
            config: room.config,
            roomName: room.roomName,
            roomCode: room.roomCode,
            hostUserId: room.hostUserId,
            maxPlayers: room.maxPlayers,
            state: room.state,
            players: Array.from(room.players.values()).map((player) => ({
                userId: player.userId,
                name: player.name,
                avatarUrl: player.avatarUrl,
                index: player.index,
                joined: player.joined,
                ready: player.ready,
                status: player.status,
            })),
            bot: room.bot ? {
                name: room.bot.name,
                avatarUrl: '',
                index: room.bot.index,
            } : null,
        };
    }

    function notifyMatchReady(room, reason) {
        const payload = publicRoomPayload(room, reason);
        room.allowedUserIds.forEach((userId) => emitToUser(userId, 'duel:ready', payload));
    }

    function removeListing(listingId) {
        const listing = listings.get(listingId);
        if (!listing) return null;
        cancelTimer(listing, 'timeout');
        listings.delete(listingId);
        broadcastListings();
        return listing;
    }

    function createPublicMatch(firstUserId, secondUserId, config, reason) {
        const room = createRoom('public', config, [firstUserId, secondUserId]);
        notifyMatchReady(room, reason || 'public');
        return room;
    }

    function createBotMatch(listing) {
        if (
            !listings.has(listing.id)
            || !isOnline(listing.ownerUserId)
            || userToRoom.has(listing.ownerUserId)
        ) {
            removeListing(listing.id);
            return;
        }
        removeListing(listing.id);
        const bot = {
            index: 1,
            name: 'TypeBot',
            status: 'waiting',
            completedWords: 0,
            correctChars: 0,
            totalKeystrokes: 0,
            wpm: 0,
            accuracy: 97 + crypto.randomInt(4),
            targetWpm: 55 + crypto.randomInt(61),
            finishedAt: null,
        };
        const room = createRoom('bot', listing.config, [listing.ownerUserId], { bot });
        notifyMatchReady(room, 'bot');
    }

    function addListing(userId, config) {
        if (listings.size >= LIMITS.maxPublicListings) throw new Error('listing_capacity');
        for (const listing of listings.values()) {
            if (!isOnline(listing.ownerUserId) || userToRoom.has(listing.ownerUserId)) {
                removeListing(listing.id);
                continue;
            }
            if (
                listing.ownerUserId !== userId
                && listing.status === 'waiting'
                && listing.key === configKey(config)
            ) {
                removeListing(listing.id);
                return { room: createPublicMatch(listing.ownerUserId, userId, config, 'auto-match') };
            }
        }

        const profile = profiles.get(userId) || { name: 'Player' };
        const listing = {
            id: shortId(),
            ownerUserId: userId,
            ownerName: profile.name,
            config,
            key: configKey(config),
            status: 'waiting',
            createdAt: Date.now(),
            timeout: null,
        };
        listing.timeout = setTimeout(() => createBotMatch(listing), LIMITS.listingTtlMs);
        listings.set(listing.id, listing);
        broadcastListings();
        return { listing };
    }

    function cumulativeCorrectChars(room, completedWords) {
        let total = 0;
        for (let i = 0; i < completedWords && i < room.prompt.words.length; i += 1) {
            total += room.prompt.words[i].length;
            if (i > 0) total += 1;
        }
        return total;
    }

    function raceStartPayload(room) {
        return {
            roomId: room.id,
            startsAt: room.startsAt,
            startsInMs: Math.max(0, room.startsAt - Date.now()),
            config: room.config,
            words: room.prompt.words,
            textHash: room.prompt.textHash,
            players: Array.from(room.players.values()).map((player) => ({
                index: player.index,
                userId: player.userId,
                name: player.name,
                avatarUrl: player.avatarUrl,
            })),
            bot: room.bot ? { index: room.bot.index, name: room.bot.name } : null,
        };
    }

    function playerResult(player, room) {
        const progress = room.config.mode === 'words'
            ? Math.min(100, Math.round((player.completedWords / room.prompt.targetWordCount) * 100))
            : Math.min(100, Math.round(((Date.now() - room.startsAt) / (room.config.amount * 1000)) * 100));
        return [
            player.index,
            player.userId,
            player.name,
            Math.max(0, Math.round(player.wpm)),
            Math.max(0, Math.min(100, Math.round(player.accuracy))),
            progress,
            player.status,
            player.finishedAt || 0,
        ];
    }

    function finishRoom(room, reason) {
        if (!room || room.state === 'finished' || room.state === 'disposed') return;
        room.state = 'finished';
        cancelTimer(room, 'countdownTimer');
        cancelTimer(room, 'joinTimer');
        cancelTimer(room, 'raceTimer');
        if (room.botTimer) clearInterval(room.botTimer);
        room.botTimer = null;

        const results = Array.from(room.players.values()).map((player) => playerResult(player, room));
        if (room.bot) {
            results.push([
                room.bot.index,
                'bot',
                room.bot.name,
                Math.round(room.bot.wpm),
                Math.round(room.bot.accuracy),
                room.config.mode === 'words'
                    ? Math.min(100, Math.round((room.bot.completedWords / room.prompt.targetWordCount) * 100))
                    : 100,
                room.bot.status,
                room.bot.finishedAt || 0,
            ]);
        }
        results.sort((a, b) => {
            const aFinished = a[6] === 'finished';
            const bFinished = b[6] === 'finished';
            if (aFinished !== bFinished) return aFinished ? -1 : 1;
            if (aFinished) return a[7] - b[7];
            return b[5] - a[5];
        });
        io.to(roomChannel(room.id)).emit('race:finished', [
            room.id,
            reason || 'complete',
            results,
            room.opponentLeft ? 1 : 0,
        ]);
        room.players.forEach((player) => {
            if (userToRoom.get(player.userId) === room.id) userToRoom.delete(player.userId);
        });
        room.disposeTimer = setTimeout(() => disposeRoom(room.id), LIMITS.finishedRoomTtlMs);
    }

    function maybeFinishRoom(room) {
        if (!room || room.state !== 'racing') return;
        const active = Array.from(room.players.values()).filter((player) => player.status !== 'left');
        const everyoneDone = active.length > 0 && active.every((player) => player.status === 'finished');
        if (everyoneDone && (!room.bot || room.bot.status === 'finished')) finishRoom(room, 'complete');
    }

    function startBot(room) {
        if (!room.bot || room.botTimer) return;
        room.bot.status = 'racing';
        room.botTimer = setInterval(() => {
            if (room.state !== 'racing') return;
            const elapsedMinutes = Math.max((Date.now() - room.startsAt) / 60_000, 1 / 120);
            const targetChars = Math.floor(room.bot.targetWpm * 5 * elapsedMinutes);
            let words = room.bot.completedWords;
            while (
                words < room.prompt.targetWordCount
                && cumulativeCorrectChars(room, words + 1) <= targetChars
            ) {
                words += 1;
            }
            room.bot.completedWords = words;
            room.bot.correctChars = cumulativeCorrectChars(room, words);
            room.bot.totalKeystrokes = Math.ceil(room.bot.correctChars / (room.bot.accuracy / 100));
            room.bot.wpm = (room.bot.correctChars / 5) / elapsedMinutes;
            const progress = room.config.mode === 'words'
                ? Math.round((words / room.prompt.targetWordCount) * 100)
                : Math.round(((Date.now() - room.startsAt) / (room.config.amount * 1000)) * 100);
            io.to(roomChannel(room.id)).emit('race:progress', [
                room.bot.index,
                Math.round(room.bot.wpm),
                Math.min(100, progress),
                1,
                room.bot.completedWords,
            ]);
            if (room.config.mode === 'words' && words >= room.prompt.targetWordCount) {
                room.bot.status = 'finished';
                room.bot.finishedAt = Date.now();
                clearInterval(room.botTimer);
                room.botTimer = null;
                maybeFinishRoom(room);
            }
        }, 1000);
    }

    function beginRace(room) {
        if (!room || room.state !== 'countdown') return;
        room.state = 'racing';
        room.startsAt = Date.now() + 250;
        room.players.forEach((player) => {
            if (player.status !== 'left') player.status = 'racing';
            player.lastSnapshotAt = room.startsAt;
        });
        io.to(roomChannel(room.id)).emit('race:start', raceStartPayload(room));
        if (room.bot) startBot(room);
        if (room.config.mode === 'time') {
            room.raceTimer = setTimeout(() => {
                room.raceTimer = setTimeout(() => {
                    room.players.forEach((player) => {
                        if (player.status === 'racing') {
                            player.status = 'finished';
                            player.finishedAt = Date.now();
                        }
                    });
                    if (room.bot && room.bot.status === 'racing') {
                        room.bot.status = 'finished';
                        room.bot.finishedAt = Date.now();
                    }
                    finishRoom(room, 'time');
                }, 750);
            }, room.config.amount * 1000 + 250);
        }
    }

    function startCountdown(room) {
        if (!room || room.state !== 'waiting') return;
        cancelTimer(room, 'joinTimer');
        room.state = 'countdown';
        let seconds = LIMITS.countdownSeconds;
        room.countdownEndsAt = Date.now() + (seconds * 1000);
        io.to(roomChannel(room.id)).emit('race:countdown', [room.id, seconds]);
        room.countdownTimer = setInterval(() => {
            seconds -= 1;
            if (seconds > 0) {
                io.to(roomChannel(room.id)).emit('race:countdown', [room.id, seconds]);
                return;
            }
            clearInterval(room.countdownTimer);
            room.countdownTimer = null;
            io.to(roomChannel(room.id)).emit('race:countdown', [room.id, 0]);
            beginRace(room);
        }, 1000);
    }

    function requiredPlayersJoined(room) {
        return Array.from(room.players.values()).every((player) => player.joined && player.status !== 'left');
    }

    function disposeRoom(roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        room.state = 'disposed';
        cancelTimer(room, 'countdownTimer');
        cancelTimer(room, 'joinTimer');
        cancelTimer(room, 'raceTimer');
        cancelTimer(room, 'disposeTimer');
        if (room.botTimer) clearInterval(room.botTimer);
        room.botTimer = null;
        room.players.forEach((player) => {
            if (userToRoom.get(player.userId) === roomId) userToRoom.delete(player.userId);
            player.snapshots.length = 0;
        });
        rooms.delete(roomId);
    }

    function leaveRace(userId, explicit) {
        const roomId = userToRoom.get(userId);
        const room = roomId && rooms.get(roomId);
        if (!room) return;
        const player = room.players.get(userId);
        if (!player || player.status === 'left') return;
        if (player.status === 'finished') {
            player.joined = false;
            player.socketId = null;
            userToRoom.delete(userId);
            return;
        }
        player.status = 'left';
        player.leftMidGame = room.state === 'racing';
        player.joined = false;
        player.socketId = null;
        room.opponentLeft = room.opponentLeft || player.leftMidGame;
        userToRoom.delete(userId);
        io.to(roomChannel(room.id)).emit('race:player-left', [
            room.id,
            player.index,
            explicit ? 'left' : 'disconnected',
        ]);
        const remaining = Array.from(room.players.values()).filter((item) => item.status !== 'left');
        if (!remaining.length) {
            disposeRoom(room.id);
        } else if (room.state !== 'racing') {
            finishRoom(room, 'opponent-left');
        } else {
            maybeFinishRoom(room);
        }
    }

    function clearUserTransientState(userId) {
        for (const [inviteId, invite] of invites) {
            if (invite.fromUserId === userId || invite.toUserId === userId) {
                clearTimeout(invite.timeout);
                invites.delete(inviteId);
                const other = invite.fromUserId === userId ? invite.toUserId : invite.fromUserId;
                emitToUser(other, 'duel:expired', [inviteId, userId]);
            }
        }
        for (const [listingId, listing] of listings) {
            if (listing.ownerUserId === userId) removeListing(listingId);
        }
    }

    function rateLimited(socket, payload) {
        const now = Date.now();
        const state = socket.data.rate || { startedAt: now, count: 0 };
        if (now - state.startedAt >= LIMITS.rateWindowMs) {
            state.startedAt = now;
            state.count = 0;
        }
        state.count += 1;
        socket.data.rate = state;
        let size = 0;
        try { size = Buffer.byteLength(JSON.stringify(payload)); } catch { return true; }
        return state.count > LIMITS.maxEventsPerWindow || size > LIMITS.maxPayloadBytes;
    }

    io.on('connection', async (socket) => {
        const userId = socket.data.userId;
        socket.join(userChannel(userId));
        if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
        onlineUsers.get(userId).add(socket.id);
        if (disconnectTimers.has(userId)) {
            clearTimeout(disconnectTimers.get(userId));
            disconnectTimers.delete(userId);
        }
        try {
            profiles.set(userId, await auth.getProfile(userId));
        } catch (error) {
            logger.warn('[multiplayer] profile lookup failed:', error && error.message);
            profiles.set(userId, { userId, name: 'Player', avatarUrl: '' });
        }
        socket.emit('multiplayer:ready', {
            userId,
            profile: profiles.get(userId),
            listings: serializeListings(),
        });
        io.emit('multiplayer:presence', [userId, 1]);

        socket.onAny((_event, payload) => {
            if (options.recordActivity) options.recordActivity();
            if (rateLimited(socket, payload)) {
                socket.emit('multiplayer:error', ['rate_limited']);
                socket.disconnect(true);
            }
        });

        socket.on('duel:challenge', async (payload, ack) => {
            try {
                const toUserId = String(payload && payload.toUserId || '');
                if (!toUserId || toUserId === userId) throw new Error('invalid_target');
                if (!isOnline(toUserId)) throw new Error('friend_offline');
                if (userToRoom.has(userId) || userToRoom.has(toUserId)) throw new Error('already_in_match');
                if (invites.size >= LIMITS.maxInvites) throw new Error('invite_capacity');
                if (!(await auth.areFriends(userId, toUserId))) throw new Error('not_friends');
                const config = normalizeConfig(payload.config);
                const invite = {
                    id: shortId(),
                    fromUserId: userId,
                    toUserId,
                    config,
                    createdAt: Date.now(),
                    timeout: null,
                };
                invite.timeout = setTimeout(() => {
                    if (!invites.delete(invite.id)) return;
                    emitToUser(userId, 'duel:expired', [invite.id, toUserId]);
                    emitToUser(toUserId, 'duel:expired', [invite.id, userId]);
                }, LIMITS.inviteTtlMs);
                invites.set(invite.id, invite);
                const from = profiles.get(userId) || { name: 'Player', avatarUrl: '' };
                emitToUser(toUserId, 'duel:incoming', {
                    inviteId: invite.id,
                    fromUserId: userId,
                    fromName: from.name,
                    fromAvatarUrl: from.avatarUrl,
                    config,
                    createdAt: invite.createdAt,
                });
                safeAck(ack, { ok: true, inviteId: invite.id });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'challenge_failed' });
            }
        });

        socket.on('duel:respond', (payload, ack) => {
            const inviteId = Array.isArray(payload) ? String(payload[0] || '') : '';
            const accepted = Array.isArray(payload) && payload[1] === 1;
            const invite = invites.get(inviteId);
            if (!invite || invite.toUserId !== userId) {
                safeAck(ack, { ok: false, error: 'invite_not_found' });
                return;
            }
            clearTimeout(invite.timeout);
            invites.delete(inviteId);
            if (!accepted) {
                emitToUser(invite.fromUserId, 'duel:rejected', [
                    invite.id,
                    userId,
                    (profiles.get(userId) || {}).name || 'Your friend',
                ]);
                safeAck(ack, { ok: true, accepted: false });
                return;
            }
            try {
                if (userToRoom.has(invite.fromUserId) || userToRoom.has(invite.toUserId)) {
                    throw new Error('already_in_match');
                }
                const room = createRoom('friend', invite.config, [invite.fromUserId, invite.toUserId]);
                notifyMatchReady(room, 'friend-accepted');
                safeAck(ack, { ok: true, accepted: true, roomId: room.id });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'room_failed' });
            }
        });

        socket.on('duel:list', (_payload, ack) => {
            safeAck(ack, { ok: true, listings: serializeListings() });
        });

        socket.on('duel:create', (payload, ack) => {
            try {
                if (userToRoom.has(userId)) throw new Error('already_in_match');
                for (const listing of listings.values()) {
                    if (listing.ownerUserId === userId) throw new Error('already_searching');
                }
                const result = addListing(userId, normalizeConfig(payload));
                safeAck(ack, {
                    ok: true,
                    listingId: result.listing && result.listing.id,
                    roomId: result.room && result.room.id,
                });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'create_failed' });
            }
        });

        socket.on('duel:cancel', (_payload, ack) => {
            let removed = false;
            for (const [listingId, listing] of listings) {
                if (listing.ownerUserId === userId) {
                    removeListing(listingId);
                    removed = true;
                }
            }
            safeAck(ack, { ok: true, removed });
        });

        socket.on('duel:join-listing', (listingId, ack) => {
            try {
                const listing = listings.get(String(listingId || ''));
                if (!listing || listing.status !== 'waiting') throw new Error('listing_unavailable');
                if (listing.ownerUserId === userId) throw new Error('own_listing');
                if (userToRoom.has(userId)) throw new Error('already_in_match');
                if (!isOnline(listing.ownerUserId) || userToRoom.has(listing.ownerUserId)) {
                    removeListing(listing.id);
                    throw new Error('listing_unavailable');
                }
                removeListing(listing.id);
                const room = createPublicMatch(listing.ownerUserId, userId, listing.config, 'listing');
                safeAck(ack, { ok: true, roomId: room.id });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'join_failed' });
            }
        });

        socket.on('match:join', (roomId, ack) => {
            const room = rooms.get(String(roomId || ''));
            if (!room || !room.allowedUserIds.has(userId) || room.state !== 'waiting') {
                safeAck(ack, { ok: false, error: 'room_unavailable' });
                return;
            }
            const player = room.players.get(userId);
            player.joined = true;
            player.socketId = socket.id;
            player.status = 'waiting';
            socket.join(roomChannel(room.id));
            userToRoom.set(userId, room.id);
            safeAck(ack, { ok: true, room: publicRoomPayload(room, room.type) });
            io.to(roomChannel(room.id)).emit('race:joined', [
                room.id,
                player.index,
                room.players.size,
            ]);
            if (room.type === 'custom') {
                io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
            }
            if (room.type !== 'custom' && requiredPlayersJoined(room)) startCountdown(room);
        });

        socket.on('match:resume', (roomId, ack) => {
            const room = rooms.get(String(roomId || ''));
            const player = room && room.players.get(userId);
            if (!room || !player || !room.allowedUserIds.has(userId)
                || !['waiting', 'countdown', 'racing'].includes(room.state)
                || player.status === 'left') {
                safeAck(ack, { ok: false, error: 'room_unavailable' });
                return;
            }
            player.joined = true;
            player.socketId = socket.id;
            socket.join(roomChannel(room.id));
            userToRoom.set(userId, room.id);
            safeAck(ack, {
                ok: true,
                room: publicRoomPayload(room, room.type),
                countdown: room.state === 'countdown'
                    ? Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000))
                    : null,
            });
        });

        socket.on('race:progress', (payload, ack) => {
            try {
                if (!Array.isArray(payload) || payload.length < 4) throw new Error('invalid_payload');
                const room = rooms.get(String(payload[0] || ''));
                if (!room || room.state !== 'racing') throw new Error('race_not_active');
                const player = room.players.get(userId);
                if (!player || player.status !== 'racing') throw new Error('player_not_active');
                const sequence = Number(payload[1]);
                const completedWords = Number(payload[2]);
                const totalKeystrokes = Number(payload[3]);
                if (
                    sequence === player.sequence
                    && completedWords === player.completedWords
                    && totalKeystrokes === player.totalKeystrokes
                ) {
                    safeAck(ack, { ok: true, duplicate: true });
                    return;
                }
                if (!Number.isInteger(sequence) || sequence <= player.sequence) throw new Error('invalid_sequence');
                if (!Number.isInteger(completedWords) || completedWords < player.completedWords) throw new Error('invalid_progress');
                if (!Number.isInteger(totalKeystrokes) || totalKeystrokes < player.totalKeystrokes) throw new Error('invalid_keystrokes');
                if (completedWords > room.prompt.targetWordCount) throw new Error('target_overflow');
                const deltaWords = completedWords - player.completedWords;
                const isFinal = room.config.mode === 'words' && completedWords === room.prompt.targetWordCount;
                const finalPacket = payload[4] === 1;
                const isTimedFinal = room.config.mode === 'time' && finalPacket
                    && Date.now() >= room.startsAt + (room.config.amount * 1000) - 500;
                if (deltaWords !== 3
                    && !(isFinal && deltaWords > 0 && deltaWords <= 3)
                    && !(isTimedFinal && deltaWords >= 0 && deltaWords <= 3)) {
                    throw new Error('three_word_packets_required');
                }
                const now = Date.now();
                if (now < room.startsAt) throw new Error('early_progress');
                const correctChars = cumulativeCorrectChars(room, completedWords);
                if (totalKeystrokes < correctChars || totalKeystrokes > correctChars + 5000) {
                    throw new Error('invalid_keystrokes');
                }
                const elapsedMinutes = Math.max((now - room.startsAt) / 60_000, 1 / 120);
                const sustainedWpm = (correctChars / 5) / elapsedMinutes;
                const deltaMinutes = Math.max((now - player.lastSnapshotAt) / 60_000, 1 / 600);
                const burstWpm = ((correctChars - player.correctChars) / 5) / deltaMinutes;
                if (sustainedWpm > maxSustainedWpm || burstWpm > maxBurstWpm) {
                    player.anomalyStrikes += 1;
                    if (player.anomalyStrikes >= 2 || sustainedWpm > maxSustainedWpm * 1.5) {
                        socket.emit('race:invalid', ['implausible_progress']);
                        leaveRace(userId, true);
                        socket.disconnect(true);
                        throw new Error('implausible_progress');
                    }
                } else {
                    player.anomalyStrikes = Math.max(0, player.anomalyStrikes - 1);
                }
                player.sequence = sequence;
                player.completedWords = completedWords;
                player.correctChars = correctChars;
                player.totalKeystrokes = totalKeystrokes;
                player.wpm = sustainedWpm;
                player.accuracy = totalKeystrokes > 0 ? (correctChars / totalKeystrokes) * 100 : 100;
                player.lastSnapshotAt = now;
                player.snapshots.push([sequence, completedWords, totalKeystrokes, now]);
                if (player.snapshots.length > LIMITS.maxRetainedSnapshots) player.snapshots.shift();
                const progress = room.config.mode === 'words'
                    ? Math.round((completedWords / room.prompt.targetWordCount) * 100)
                    : Math.round(((now - room.startsAt) / (room.config.amount * 1000)) * 100);
                io.to(roomChannel(room.id)).emit('race:progress', [
                    player.index,
                    Math.round(player.wpm),
                    Math.min(100, progress),
                    1,
                    player.completedWords,
                ]);
                if (isFinal) {
                    player.status = 'finished';
                    player.finishedAt = now;
                    maybeFinishRoom(room);
                }
                safeAck(ack, { ok: true });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'progress_rejected' });
            }
        });

        socket.on('race:leave', (roomId, ack) => {
            const current = userToRoom.get(userId);
            if (current && (!roomId || current === roomId)) leaveRace(userId, true);
            safeAck(ack, { ok: true });
        });

        socket.on('room:create', (payload, ack) => {
            try {
                if (userToRoom.has(userId)) throw new Error('already_in_match');
                const config = normalizeConfig(payload && payload.config);
                const maxPlayers = clampInteger(payload && payload.maxPlayers, 2, LIMITS.maxPlayersPerRoom, 8);
                let roomCode;
                do { roomCode = String(crypto.randomInt(1000, 10_000)); }
                while (Array.from(rooms.values()).some((room) => room.roomCode === roomCode));
                const room = createRoom('custom', config, [userId], {
                    hostUserId: userId,
                    maxPlayers,
                    roomCode,
                    roomName: String(payload && payload.name || 'Private Room').slice(0, 48),
                });
                safeAck(ack, { ok: true, roomId: room.id, roomCode });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'room_create_failed' });
            }
        });

        socket.on('room:join-code', (code, ack) => {
            if (userToRoom.has(userId)) {
                safeAck(ack, { ok: false, error: 'already_in_match' });
                return;
            }
            const room = Array.from(rooms.values()).find((item) => item.roomCode === String(code || ''));
            if (!room || room.type !== 'custom' || room.state !== 'waiting') {
                safeAck(ack, { ok: false, error: 'room_not_found' });
                return;
            }
            if (!room.players.has(userId)) {
                if (room.players.size >= room.maxPlayers) {
                    safeAck(ack, { ok: false, error: 'room_full' });
                    return;
                }
                room.allowedUserIds.add(userId);
                room.players.set(userId, createPlayer(userId, room.players.size, profiles.get(userId)));
                userToRoom.set(userId, room.id);
            }
            io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
            safeAck(ack, { ok: true, roomId: room.id });
        });

        socket.on('room:ready', (roomId, ack) => {
            const room = rooms.get(String(roomId || ''));
            const player = room && room.players.get(userId);
            if (!room || room.type !== 'custom' || !player) {
                safeAck(ack, { ok: false, error: 'room_not_found' });
                return;
            }
            player.ready = true;
            io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
            safeAck(ack, { ok: true });
            const allReady = room.players.size >= 2
                && Array.from(room.players.values()).every((item) => item.joined && item.ready);
            if (allReady) startCountdown(room);
        });

        socket.on('room:start', (roomId, ack) => {
            const room = rooms.get(String(roomId || ''));
            if (!room || room.type !== 'custom' || room.hostUserId !== userId) {
                safeAck(ack, { ok: false, error: 'forbidden' });
                return;
            }
            const allReady = room.players.size >= 2
                && Array.from(room.players.values()).every((player) => player.joined && player.ready);
            if (!allReady) {
                safeAck(ack, { ok: false, error: 'players_not_ready' });
                return;
            }
            startCountdown(room);
            safeAck(ack, { ok: true });
        });

        socket.on('disconnect', () => {
            const sockets = onlineUsers.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (!sockets.size) onlineUsers.delete(userId);
            }
            if (isOnline(userId)) return;
            io.emit('multiplayer:presence', [userId, 0]);
            const timer = setTimeout(() => {
                disconnectTimers.delete(userId);
                clearUserTransientState(userId);
                leaveRace(userId, false);
            }, LIMITS.reconnectGraceMs);
            disconnectTimers.set(userId, timer);
        });
    });

    function close() {
        invites.forEach((invite) => clearTimeout(invite.timeout));
        listings.forEach((listing) => clearTimeout(listing.timeout));
        rooms.forEach((room) => disposeRoom(room.id));
        disconnectTimers.forEach((timer) => clearTimeout(timer));
        io.close();
    }

    logger.info('[multiplayer] ephemeral Socket.IO server initialized');
    return {
        io,
        close,
        state: { onlineUsers, invites, listings, rooms },
        hasSupabaseServiceRole: auth.hasSupabaseServiceRole,
    };
}

module.exports = { createMultiplayerServer };
