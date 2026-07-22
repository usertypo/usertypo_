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
            errorsMade: 0,
            extraChars: 0,
            rawChars: 0,
            finalStats: null,
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
            inactivityTimer: null,
            lastActivityAt: Date.now(),
            opponentLeft: false,
        };
        rooms.set(id, room);
        allowedUserIds.forEach((userId) => userToRoom.set(userId, id));
        if (type === 'custom') {
            touchRoomActivity(room);
        } else if (type !== 'custom') {
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
                isBot: true,
                ready: true,
                status: room.bot.status || 'waiting',
            } : null,
        };
    }

    const ROOM_BOT_NAMES = Object.freeze([
        'TypeBot', 'KeyClaw', 'NeonType', 'SwiftKeys', 'PixelPace',
        'GlyphRunner', 'DashType', 'OrbitKeys', 'FluxType', 'NovaTap',
        'CipherKeys', 'EchoType', 'PulseKeys', 'AeroType', 'QuarkKeys',
    ]);

    function occupiedSlots(room) {
        const humans = Array.from(room.players.values()).filter((player) => player.status !== 'left').length;
        return humans + (room.bot ? 1 : 0);
    }

    function nextPlayerIndex(room) {
        let max = -1;
        room.players.forEach((player) => {
            if (player.index > max) max = player.index;
        });
        if (room.bot && room.bot.index > max) max = room.bot.index;
        return max + 1;
    }

    function createCustomRoomBot(room) {
        return {
            index: nextPlayerIndex(room),
            name: ROOM_BOT_NAMES[crypto.randomInt(ROOM_BOT_NAMES.length)],
            status: 'waiting',
            completedWords: 0,
            correctChars: 0,
            totalKeystrokes: 0,
            wpm: 0,
            accuracy: 97 + crypto.randomInt(4),
            targetWpm: 55 + crypto.randomInt(61),
            finishedAt: null,
            snapshots: [],
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
            snapshots: [],
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
            // Home-page stats count: each completed word includes its trailing space.
            total += room.prompt.words[i].length + 1;
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
            bot: room.bot ? { index: room.bot.index, name: room.bot.name, isBot: true } : null,
        };
    }

    function computeConsistencyFromSnapshots(snapshots) {
        if (!Array.isArray(snapshots) || snapshots.length < 2) return 100;
        const intervals = [];
        for (let i = 1; i < snapshots.length; i += 1) {
            const delta = snapshots[i][3] - snapshots[i - 1][3];
            if (delta > 0) intervals.push(delta);
        }
        if (intervals.length < 2) return 100;
        const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
        if (!mean) return 100;
        const variance = intervals.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / intervals.length;
        const cov = Math.sqrt(variance) / mean;
        const kogasa = 100 * (1 - Math.tanh(cov + Math.pow(cov, 3) / 3 + Math.pow(cov, 5) / 5));
        return Math.max(0, Math.min(100, Math.round(kogasa)));
    }

    function raceDisplaySeconds(room, participant) {
        if (participant && participant.finalStats && participant.finalStats.displaySeconds != null) {
            return participant.finalStats.displaySeconds;
        }
        if (participant && participant.finishedAt && room.startsAt) {
            return Math.floor((participant.finishedAt - room.startsAt) / 1000);
        }
        return 0;
    }

    function playerResult(player, room) {
        const progress = room.config.mode === 'words'
            ? Math.min(100, Math.round((player.completedWords / room.prompt.targetWordCount) * 100))
            : Math.min(100, Math.round(((Date.now() - room.startsAt) / (room.config.amount * 1000)) * 100));
        const finalStats = player.finalStats || {};
        const validChars = finalStats.validChars != null ? finalStats.validChars : (player.correctChars || 0);
        const rawChars = finalStats.rawChars != null ? finalStats.rawChars : (player.totalKeystrokes || 0);
        const errorsMade = finalStats.errorsMade != null ? finalStats.errorsMade : Math.max(0, (player.totalKeystrokes || 0) - validChars);
        const extraChars = finalStats.extraChars != null ? finalStats.extraChars : 0;
        const displaySeconds = raceDisplaySeconds(room, player);
        const elapsedMinutes = Math.max(displaySeconds / 60, 2 / 60);
        const exactWpm = (validChars / 5) / elapsedMinutes;
        const exactRawWpm = (rawChars / 5) / elapsedMinutes;
        const totalKeystrokes = player.totalKeystrokes || 0;
        const accuracy = totalKeystrokes > 0
            ? Math.max(0, ((totalKeystrokes - errorsMade) / totalKeystrokes) * 100)
            : 100;
        return [
            player.index,
            player.userId,
            player.name,
            Math.max(0, Math.round(exactWpm)),
            Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10)),
            progress,
            player.status,
            player.finishedAt || 0,
            validChars,
            rawChars,
            Math.max(0, Math.round(exactRawWpm)),
            computeConsistencyFromSnapshots(player.snapshots),
            displaySeconds,
            errorsMade,
            extraChars,
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
            const botProgress = room.config.mode === 'words'
                ? Math.min(100, Math.round((room.bot.completedWords / room.prompt.targetWordCount) * 100))
                : 100;
            const botDisplaySeconds = raceDisplaySeconds(room, room.bot);
            const botElapsedMinutes = Math.max(botDisplaySeconds / 60, 2 / 60);
            const botValidChars = room.bot.correctChars || 0;
            const botRawChars = room.bot.totalKeystrokes || 0;
            const botErrors = Math.max(0, botRawChars - botValidChars);
            results.push([
                room.bot.index,
                'bot',
                room.bot.name,
                Math.max(0, Math.round((botValidChars / 5) / botElapsedMinutes)),
                Math.max(0, Math.min(100, Math.round(room.bot.accuracy * 10) / 10)),
                botProgress,
                room.bot.status,
                room.bot.finishedAt || 0,
                botValidChars,
                botRawChars,
                Math.max(0, Math.round((botRawChars / 5) / botElapsedMinutes)),
                computeConsistencyFromSnapshots(room.bot.snapshots),
                botDisplaySeconds,
                botErrors,
                0,
            ]);
        }
        results.sort((a, b) => {
            const aFinished = a[6] === 'finished' ? 1 : 0;
            const bFinished = b[6] === 'finished' ? 1 : 0;
            if (aFinished !== bFinished) return bFinished - aFinished;
            if (b[3] !== a[3]) return b[3] - a[3]; // higher WPM first
            if (b[4] !== a[4]) return b[4] - a[4]; // higher accuracy
            return (a[7] || 0) - (b[7] || 0); // earlier finish as tie-break
        });
        room.lastResults = results;
        room.finishReason = reason || 'complete';
        io.to(roomChannel(room.id)).emit('race:finished', [
            room.id,
            reason || 'complete',
            results,
            room.opponentLeft ? 1 : 0,
            room.type,
        ]);

        if (room.type === 'custom') {
            cancelTimer(room, 'disposeTimer');
            room.returnLobbyVotes = new Set();
            room.players.forEach((player) => {
                if (player.status === 'left') return;
                player.returnLobby = false;
            });
            touchRoomActivity(room);
            emitReturnLobbyState(room);
            return;
        }

        room.players.forEach((player) => {
            if (userToRoom.get(player.userId) === room.id) userToRoom.delete(player.userId);
        });
        room.disposeTimer = setTimeout(() => disposeRoom(room.id), LIMITS.finishedRoomTtlMs);
    }

    function remainingCustomPlayers(room) {
        return Array.from(room.players.values()).filter((player) => player.status !== 'left');
    }

    function emitReturnLobbyState(room) {
        if (!room || room.type !== 'custom') return;
        const remaining = remainingCustomPlayers(room);
        const agreed = remaining.filter((player) => player.returnLobby);
        io.to(roomChannel(room.id)).emit('room:return-lobby-state', [
            room.id,
            agreed.length,
            remaining.length,
            agreed.map((player) => player.userId),
        ]);
    }

    function resetPlayerForLobby(player) {
        player.ready = false;
        player.returnLobby = false;
        player.status = 'waiting';
        player.sequence = 0;
        player.completedWords = 0;
        player.correctChars = 0;
        player.totalKeystrokes = 0;
        player.wpm = 0;
        player.accuracy = 100;
        player.errorsMade = 0;
        player.extraChars = 0;
        player.rawChars = 0;
        player.finalStats = null;
        player.lastSnapshotAt = 0;
        player.anomalyStrikes = 0;
        player.finishedAt = null;
        player.leftMidGame = false;
        player.snapshots.length = 0;
    }

    function resetCustomRoomToLobby(room) {
        if (!room || room.type !== 'custom' || room.state === 'disposed') return;
        cancelTimer(room, 'countdownTimer');
        cancelTimer(room, 'raceTimer');
        cancelTimer(room, 'disposeTimer');
        if (room.botTimer) clearInterval(room.botTimer);
        room.botTimer = null;
        room.state = 'waiting';
        room.prompt = createPrompt(root, room.config);
        room.startsAt = null;
        room.countdownEndsAt = null;
        room.opponentLeft = false;
        room.lastResults = null;
        room.finishReason = null;
        room.returnLobbyVotes = new Set();
        room.bot = null;
        // Drop anyone who left mid-match so they can be invited/join again cleanly.
        Array.from(room.players.entries()).forEach(([uid, player]) => {
            if (player.status === 'left') {
                room.players.delete(uid);
                room.allowedUserIds.delete(uid);
            }
        });
        Array.from(room.players.values()).forEach((item, index) => { item.index = index; });
        remainingCustomPlayers(room).forEach(resetPlayerForLobby);
        touchRoomActivity(room);
        const payload = publicRoomPayload(room, 'custom');
        io.to(roomChannel(room.id)).emit('room:returned-to-lobby', payload);
        io.to(roomChannel(room.id)).emit('room:state', payload);
    }

    function maybeReturnCustomRoomToLobby(room) {
        if (!room || room.type !== 'custom' || room.state !== 'finished') return;
        const remaining = remainingCustomPlayers(room);
        if (!remaining.length) {
            room.bot = null;
            closeCustomRoom(room, 'empty');
            return;
        }
        if (remaining.every((player) => player.returnLobby)) {
            resetCustomRoomToLobby(room);
        }
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
            room.bot.snapshots.push([0, room.bot.completedWords, room.bot.totalKeystrokes, Date.now()]);
            if (room.bot.snapshots.length > LIMITS.maxRetainedSnapshots) room.bot.snapshots.shift();
            const progress = room.config.mode === 'words'
                ? Math.round((words / room.prompt.targetWordCount) * 100)
                : Math.round(((Date.now() - room.startsAt) / (room.config.amount * 1000)) * 100);
            io.to(roomChannel(room.id)).emit('race:progress', [
                room.bot.index,
                room.bot.wpm,
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

    function touchRoomActivity(room) {
        if (!room || room.type !== 'custom' || room.state === 'disposed') return;
        room.lastActivityAt = Date.now();
        cancelTimer(room, 'inactivityTimer');
        room.inactivityTimer = setTimeout(() => {
            if (room.state === 'disposed') return;
            if (room.state === 'waiting' || room.state === 'finished') {
                closeCustomRoom(room, 'inactivity');
            }
        }, LIMITS.roomInactivityMs);
    }

    function closeCustomRoom(room, reason, excludeUserId) {
        if (!room || room.type !== 'custom' || room.state === 'disposed') return;
        const payload = [room.id, reason || 'closed', room.roomCode || ''];
        room.allowedUserIds.forEach((uid) => {
            if (excludeUserId && uid === excludeUserId) return;
            emitToUser(uid, 'room:closed', payload);
        });
        disposeRoom(room.id);
    }

    function disposeRoom(roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        room.state = 'disposed';
        cancelTimer(room, 'countdownTimer');
        cancelTimer(room, 'joinTimer');
        cancelTimer(room, 'raceTimer');
        cancelTimer(room, 'disposeTimer');
        cancelTimer(room, 'inactivityTimer');
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
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) {
            // Stale mapping after dispose — always clear so create/join can proceed.
            userToRoom.delete(userId);
            return;
        }
        const player = room.players.get(userId);
        if (!player || player.status === 'left') {
            userToRoom.delete(userId);
            disposeCustomRoomIfNoHumans(room);
            return;
        }
        if (player.status === 'finished' || room.state === 'finished') {
            if (room.type === 'custom' && room.state === 'finished') {
                player.status = 'left';
                player.joined = false;
                player.socketId = null;
                player.returnLobby = false;
                if (room.returnLobbyVotes) room.returnLobbyVotes.delete(userId);
                userToRoom.delete(userId);
                if (userId === room.hostUserId) {
                    closeCustomRoom(room, 'host-left', userId);
                    return;
                }
                room.players.delete(userId);
                room.allowedUserIds.delete(userId);
                Array.from(room.players.values()).forEach((item, index) => { item.index = index; });
                emitReturnLobbyState(room);
                maybeReturnCustomRoomToLobby(room);
                disposeCustomRoomIfNoHumans(room);
                return;
            }
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
        if (room.type === 'custom' && (room.state === 'waiting' || room.state === 'countdown')) {
            if (userId === room.hostUserId) {
                closeCustomRoom(room, 'host-left', userId);
                return;
            }
            if (room.state === 'countdown') {
                cancelTimer(room, 'countdownTimer');
                room.state = 'waiting';
                room.countdownEndsAt = null;
                room.startsAt = null;
            }
            room.players.delete(userId);
            room.allowedUserIds.delete(userId);
            Array.from(room.players.values()).forEach((item, index) => { item.index = index; });
            io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
            touchRoomActivity(room);
            disposeCustomRoomIfNoHumans(room);
            return;
        }
        io.to(roomChannel(room.id)).emit('race:player-left', [
            room.id,
            player.index,
            explicit ? 'left' : 'disconnected',
        ]);
        const remaining = Array.from(room.players.values()).filter((item) => item.status !== 'left');
        if (!remaining.length) {
            if (room.type === 'custom') {
                room.bot = null;
                closeCustomRoom(room, 'empty');
            } else {
                disposeRoom(room.id);
            }
        } else if (room.state !== 'racing') {
            finishRoom(room, 'opponent-left');
        } else {
            maybeFinishRoom(room);
        }
    }

    function disposeCustomRoomIfNoHumans(room) {
        if (!room || room.type !== 'custom' || room.state === 'disposed') return;
        const humans = Array.from(room.players.values()).filter((player) => player.status !== 'left');
        // Bots must not keep an empty room alive.
        if (!humans.length) {
            room.bot = null;
            closeCustomRoom(room, 'empty');
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
        const ownListing = Array.from(listings.values()).find((listing) => (
            listing.ownerUserId === userId && listing.status === 'waiting'
        ));
        const outgoingChallenges = Array.from(invites.values())
            .filter((invite) => invite.fromUserId === userId)
            .map((invite) => ({
                inviteId: invite.id,
                targetUserId: invite.toUserId,
                targetName: (profiles.get(invite.toUserId) || {}).name || 'your friend',
                config: invite.config,
                createdAt: invite.createdAt,
            }));
        socket.emit('multiplayer:ready', {
            userId,
            profile: profiles.get(userId),
            listings: serializeListings(),
            search: ownListing ? {
                listingId: ownListing.id,
                config: ownListing.config,
                createdAt: ownListing.createdAt,
            } : null,
            outgoingChallenges,
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

        socket.on('duel:cancel-invite', (inviteIdValue, ack) => {
            const inviteId = String(inviteIdValue || '');
            const invite = invites.get(inviteId);
            if (!invite || invite.fromUserId !== userId) {
                safeAck(ack, { ok: false, error: 'invite_not_found' });
                return;
            }
            clearTimeout(invite.timeout);
            invites.delete(inviteId);
            emitToUser(invite.toUserId, 'duel:expired', [invite.id, userId, 'cancelled']);
            safeAck(ack, { ok: true, cancelled: true });
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
            if (!room || !room.allowedUserIds.has(userId)) {
                safeAck(ack, { ok: false, error: 'room_unavailable' });
                return;
            }
            const player = room.players.get(userId);
            if (!player || player.status === 'left') {
                safeAck(ack, { ok: false, error: 'room_unavailable' });
                return;
            }

            // Active match: re-attach socket without restarting countdown/race.
            if (room.state === 'countdown' || room.state === 'racing' || room.state === 'finished') {
                player.joined = true;
                player.socketId = socket.id;
                socket.join(roomChannel(room.id));
                userToRoom.set(userId, room.id);
                safeAck(ack, {
                    ok: true,
                    room: publicRoomPayload(room, room.type),
                    state: room.state,
                    countdown: room.state === 'countdown'
                        ? Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000))
                        : null,
                    race: (room.state === 'countdown' || room.state === 'racing')
                        ? raceStartPayload(room)
                        : null,
                    results: room.state === 'finished' ? (room.lastResults || null) : null,
                    finishReason: room.state === 'finished' ? (room.finishReason || 'complete') : null,
                    opponentLeft: room.state === 'finished' ? (room.opponentLeft ? 1 : 0) : 0,
                });
                return;
            }

            if (room.state !== 'waiting') {
                safeAck(ack, { ok: false, error: 'room_unavailable' });
                return;
            }

            player.joined = true;
            player.socketId = socket.id;
            player.status = 'waiting';
            socket.join(roomChannel(room.id));
            userToRoom.set(userId, room.id);
            safeAck(ack, {
                ok: true,
                room: publicRoomPayload(room, room.type),
                state: 'waiting',
                countdown: null,
                race: null,
            });
            io.to(roomChannel(room.id)).emit('race:joined', [
                room.id,
                player.index,
                room.players.size,
            ]);
            if (room.type === 'custom') {
                io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
                touchRoomActivity(room);
            }
            if (room.type !== 'custom' && requiredPlayersJoined(room)) startCountdown(room);
        });

        socket.on('match:resume', (roomId, ack) => {
            const room = rooms.get(String(roomId || ''));
            const player = room && room.players.get(userId);
            if (!room || !player || !room.allowedUserIds.has(userId)
                || !['waiting', 'countdown', 'racing', 'finished'].includes(room.state)
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
                state: room.state,
                countdown: room.state === 'countdown'
                    ? Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000))
                    : null,
                race: (room.state === 'countdown' || room.state === 'racing')
                    ? raceStartPayload(room)
                    : null,
                results: room.state === 'finished' ? (room.lastResults || null) : null,
                finishReason: room.state === 'finished' ? (room.finishReason || 'complete') : null,
                opponentLeft: room.state === 'finished' ? (room.opponentLeft ? 1 : 0) : 0,
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
                const finalStatsPayload = Array.isArray(payload[5]) ? payload[5] : null;
                const now = Date.now();
                const isTimedFinal = room.config.mode === 'time' && finalPacket
                    && now >= room.startsAt + (room.config.amount * 1000) - 500;
                const isCustomRoom = room.type === 'custom';
                if (isCustomRoom) {
                    // Rooms: allow frequent WPM snapshots (~500ms). Dual still requires 3-word deltas.
                    if (!finalPacket && !isFinal && !isTimedFinal && (now - player.lastSnapshotAt) < 450) {
                        safeAck(ack, { ok: true, throttled: true });
                        return;
                    }
                    if (deltaWords < 0) throw new Error('invalid_progress');
                } else if (deltaWords !== 3
                    && !(isFinal && deltaWords > 0 && deltaWords <= 3)
                    && !(isTimedFinal && deltaWords >= 0 && deltaWords <= 3)) {
                    throw new Error('three_word_packets_required');
                }
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
                if (finalPacket && finalStatsPayload && finalStatsPayload.length >= 4) {
                    const validChars = Number(finalStatsPayload[0]);
                    const rawChars = Number(finalStatsPayload[1]);
                    const errorsMade = Number(finalStatsPayload[2]);
                    const extraChars = Number(finalStatsPayload[3]);
                    const displaySeconds = Number(finalStatsPayload[4]);
                    if (
                        Number.isInteger(validChars)
                        && Number.isInteger(rawChars)
                        && Number.isInteger(errorsMade)
                        && Number.isInteger(extraChars)
                        && validChars >= 0
                        && rawChars >= validChars
                        && errorsMade >= 0
                        && extraChars >= 0
                        && totalKeystrokes >= errorsMade
                    ) {
                        player.finalStats = {
                            validChars,
                            rawChars,
                            errorsMade,
                            extraChars,
                            displaySeconds: Number.isFinite(displaySeconds) && displaySeconds >= 0
                                ? Math.floor(displaySeconds)
                                : Math.floor((now - room.startsAt) / 1000),
                        };
                    }
                }
                const progress = room.config.mode === 'words'
                    ? Math.round((completedWords / room.prompt.targetWordCount) * 100)
                    : Math.round(((now - room.startsAt) / (room.config.amount * 1000)) * 100);
                io.to(roomChannel(room.id)).emit('race:progress', [
                    player.index,
                    player.wpm,
                    Math.min(100, progress),
                    1,
                    player.completedWords,
                ]);
                if (isFinal || isTimedFinal) {
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
            if (!current) {
                safeAck(ack, { ok: true });
                return;
            }
            if (!roomId || current === String(roomId || '')) {
                leaveRace(userId, true);
            } else if (!rooms.get(current)) {
                userToRoom.delete(userId);
            }
            safeAck(ack, { ok: true });
        });

        socket.on('room:create', (payload, ack) => {
            try {
                // Abandon any stuck/previous membership so browser-back leftovers
                // cannot permanently block creating a new room.
                if (userToRoom.has(userId)) {
                    leaveRace(userId, true);
                }
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
            const roomCodeValue = String(code || '').trim();
            const existingRoomId = userToRoom.get(userId);
            if (existingRoomId) {
                const existing = rooms.get(existingRoomId);
                if (existing && existing.type === 'custom' && existing.roomCode === roomCodeValue) {
                    safeAck(ack, { ok: true, roomId: existing.id });
                    return;
                }
                // Leave stale/other membership so join isn't permanently blocked.
                leaveRace(userId, true);
            }
            const room = Array.from(rooms.values()).find((item) => item.roomCode === roomCodeValue);
            if (!room || room.type !== 'custom' || room.state !== 'waiting') {
                safeAck(ack, { ok: false, error: 'room_not_found' });
                return;
            }
            if (!room.players.has(userId)) {
                if (occupiedSlots(room) >= room.maxPlayers) {
                    safeAck(ack, { ok: false, error: 'room_full' });
                    return;
                }
                room.allowedUserIds.add(userId);
                room.players.set(userId, createPlayer(userId, nextPlayerIndex(room), profiles.get(userId)));
                userToRoom.set(userId, room.id);
            } else {
                const existingPlayer = room.players.get(userId);
                if (!existingPlayer || existingPlayer.status === 'left') {
                    if (occupiedSlots(room) >= room.maxPlayers) {
                        safeAck(ack, { ok: false, error: 'room_full' });
                        return;
                    }
                    room.allowedUserIds.add(userId);
                    room.players.set(userId, createPlayer(
                        userId,
                        existingPlayer ? existingPlayer.index : nextPlayerIndex(room),
                        profiles.get(userId),
                    ));
                    userToRoom.set(userId, room.id);
                }
            }
            io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
            touchRoomActivity(room);
            safeAck(ack, { ok: true, roomId: room.id });
        });

        socket.on('room:invite', async (payload, ack) => {
            try {
                const roomId = String(payload && payload.roomId || '');
                const toUserId = String(payload && payload.toUserId || '');
                const room = rooms.get(roomId);
                if (!room || room.type !== 'custom' || room.state !== 'waiting') {
                    throw new Error('room_not_found');
                }
                if (!room.players.has(userId)) throw new Error('forbidden');
                if (!toUserId || toUserId === userId) throw new Error('invalid_target');
                const existing = room.players.get(toUserId);
                if (existing && existing.status !== 'left') throw new Error('already_in_room');
                if (userToRoom.has(toUserId)) throw new Error('already_in_match');
                if (!isOnline(toUserId)) throw new Error('friend_offline');
                if (occupiedSlots(room) >= room.maxPlayers) throw new Error('room_full');
                if (!(await auth.areFriends(userId, toUserId))) throw new Error('not_friends');
                const from = profiles.get(userId) || { name: 'Player', avatarUrl: '' };
                emitToUser(toUserId, 'room:invite', {
                    roomId: room.id,
                    roomCode: room.roomCode,
                    roomName: room.roomName,
                    fromUserId: userId,
                    fromName: from.name,
                    config: room.config,
                });
                touchRoomActivity(room);
                safeAck(ack, { ok: true });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'invite_failed' });
            }
        });

        socket.on('room:remove-player', (payload, ack) => {
            try {
                const roomId = String(payload && payload.roomId || '');
                const targetUserId = String(payload && payload.targetUserId || '');
                const room = rooms.get(roomId);
                if (!room || room.type !== 'custom' || room.state !== 'waiting') {
                    throw new Error('room_not_found');
                }
                if (room.hostUserId !== userId) throw new Error('forbidden');
                if (!targetUserId || targetUserId === userId) throw new Error('invalid_target');

                if (targetUserId === 'bot') {
                    if (!room.bot) throw new Error('bot_not_found');
                    room.bot = null;
                    io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
                    touchRoomActivity(room);
                    disposeCustomRoomIfNoHumans(room);
                    safeAck(ack, { ok: true });
                    return;
                }

                const target = room.players.get(targetUserId);
                if (!target || target.status === 'left') throw new Error('player_not_found');
                emitToUser(targetUserId, 'room:kicked', {
                    roomId: room.id,
                    roomCode: room.roomCode || '',
                    byUserId: userId,
                });
                leaveRace(targetUserId, true);
                safeAck(ack, { ok: true });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'remove_failed' });
            }
        });

        socket.on('room:ready', (roomId, ack) => {
            const room = rooms.get(String(roomId || ''));
            const player = room && room.players.get(userId);
            if (!room || room.type !== 'custom' || room.state !== 'waiting' || !player) {
                safeAck(ack, { ok: false, error: 'room_not_found' });
                return;
            }
            player.ready = true;
            touchRoomActivity(room);
            io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
            safeAck(ack, { ok: true });
            if (userId === room.hostUserId) {
                room.players.forEach((item, uid) => {
                    if (uid !== userId) {
                        emitToUser(uid, 'room:host-ready', {
                            roomId: room.id,
                            roomName: room.roomName,
                            hostName: player.name,
                        });
                    }
                });
            }
        });

        socket.on('room:return-lobby', (roomId, ack) => {
            try {
                const room = rooms.get(String(roomId || ''));
                const player = room && room.players.get(userId);
                if (!room || room.type !== 'custom' || room.state !== 'finished' || !player || player.status === 'left') {
                    throw new Error('room_not_found');
                }
                player.returnLobby = true;
                if (!room.returnLobbyVotes) room.returnLobbyVotes = new Set();
                room.returnLobbyVotes.add(userId);
                touchRoomActivity(room);
                emitReturnLobbyState(room);
                maybeReturnCustomRoomToLobby(room);
                safeAck(ack, { ok: true });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'return_lobby_failed' });
            }
        });

        socket.on('room:add-bot', (roomId, ack) => {
            try {
                const room = rooms.get(String(roomId || ''));
                if (!room || room.type !== 'custom' || room.state !== 'waiting') {
                    throw new Error('room_not_found');
                }
                if (room.hostUserId !== userId) throw new Error('forbidden');
                if (room.bot) throw new Error('bot_already_added');
                if (occupiedSlots(room) >= room.maxPlayers) throw new Error('room_full');
                room.bot = createCustomRoomBot(room);
                touchRoomActivity(room);
                io.to(roomChannel(room.id)).emit('room:state', publicRoomPayload(room, 'custom'));
                safeAck(ack, { ok: true, bot: publicRoomPayload(room, 'custom').bot });
            } catch (error) {
                safeAck(ack, { ok: false, error: error.message || 'add_bot_failed' });
            }
        });

        socket.on('room:start', (payload, ack) => {
            const roomId = payload && typeof payload === 'object'
                ? String(payload.roomId || '')
                : String(payload || '');
            const force = !!(payload && typeof payload === 'object' && payload.force);
            const room = rooms.get(roomId);
            if (!room || room.type !== 'custom' || room.hostUserId !== userId || room.state !== 'waiting') {
                safeAck(ack, { ok: false, error: 'forbidden' });
                return;
            }
            const readyPlayers = Array.from(room.players.values()).filter(
                (item) => item.ready && item.status !== 'left',
            );
            const readyCount = readyPlayers.length + (room.bot ? 1 : 0);
            if (readyCount < LIMITS.minReadyToStart) {
                safeAck(ack, { ok: false, error: 'not_enough_ready' });
                return;
            }
            if (!force) {
                const allReady = room.players.size >= 2
                    && Array.from(room.players.values()).every(
                        (item) => item.status === 'left' || (item.joined && item.ready),
                    );
                if (!allReady) {
                    safeAck(ack, { ok: false, error: 'players_not_ready' });
                    return;
                }
            }
            touchRoomActivity(room);
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
