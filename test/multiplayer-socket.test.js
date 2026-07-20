'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { io: createClient } = require('socket.io-client');
const { createMultiplayerServer } = require('../multiplayer/socket-server');

const TEST_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_PUBLIC_KEY = TEST_KEYS.publicKey.export({ type: 'spki', format: 'pem' });

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function signToken(userId) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }));
    const payload = base64url(JSON.stringify({
        sub: userId,
        sid: 'sess_' + userId,
        iss: 'https://clerk.test',
        iat: now,
        nbf: now - 5,
        exp: now + 300,
    }));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + payload), TEST_KEYS.privateKey);
    return header + '.' + payload + '.' + signature.toString('base64url');
}

function once(socket, event, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for ' + event)), timeoutMs);
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out sending ' + event)), 5000);
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            if (!response || response.ok === false) {
                reject(new Error(response && response.error || event + ' failed'));
                return;
            }
            resolve(response);
        });
    });
}

function connect(url, token) {
    return new Promise((resolve, reject) => {
        const socket = createClient(url, {
            auth: { token },
            transports: ['websocket'],
            reconnection: false,
            autoConnect: false,
        });
        const timer = setTimeout(() => {
            try { socket.close(); } catch (_) { /* ignore */ }
            reject(new Error('Timed out waiting for multiplayer:ready'));
        }, 8000);
        socket.once('multiplayer:ready', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.once('connect_error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        socket.connect();
    });
}

test('matches authenticated players and starts one server-owned race', { timeout: 15_000 }, async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    const multiplayer = createMultiplayerServer(server, {
        root: require('node:path').resolve(__dirname, '..'),
        env: {
            NODE_ENV: 'test',
            CLERK_JWT_KEY: TEST_PUBLIC_KEY,
            CLERK_SECRET_KEY: 'sk_test_local',
            ALLOW_UNVERIFIED_FRIENDS: 'true',
            MAX_BURST_WPM: '500',
            MAX_SUSTAINED_WPM: '400',
        },
        logger: { info() {}, warn() {} },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const url = 'http://127.0.0.1:' + address.port;
    let first;
    let second;

    try {
        first = await connect(url, signToken('user_one'));
        second = await connect(url, signToken('user_two'));
        const challenge = await emitAck(first, 'duel:challenge', {
            toUserId: 'user_two',
            config: { mode: 'words', amount: 10, lang: 'english' },
        });
        await emitAck(first, 'duel:cancel-invite', challenge.inviteId);
        await assert.rejects(
            emitAck(second, 'duel:respond', [challenge.inviteId, 1]),
            /invite_not_found/
        );
        const firstReady = once(first, 'duel:ready');
        const secondReady = once(second, 'duel:ready');

        const firstSearch = await emitAck(first, 'duel:create', {
            mode: 'words',
            amount: 10,
            lang: 'english',
        });
        assert.ok(firstSearch.listingId);
        await assert.rejects(
            emitAck(first, 'duel:create', { mode: 'words', amount: 10, lang: 'english' }),
            /already_searching/
        );
        await assert.rejects(
            emitAck(first, 'duel:join-listing', firstSearch.listingId),
            /own_listing/
        );
        const secondSearch = await emitAck(second, 'duel:create', {
            mode: 'words',
            amount: 10,
            lang: 'english',
        });
        assert.ok(secondSearch.roomId);

        const [firstMatch, secondMatch] = await Promise.all([firstReady, secondReady]);
        assert.equal(firstMatch.roomId, secondMatch.roomId);
        const firstStart = once(first, 'race:start');
        const secondStart = once(second, 'race:start');
        await Promise.all([
            emitAck(first, 'match:join', firstMatch.roomId),
            emitAck(second, 'match:join', secondMatch.roomId),
        ]);
        const [raceForFirst, raceForSecond] = await Promise.all([firstStart, secondStart]);
        assert.equal(raceForFirst.textHash, raceForSecond.textHash);
        assert.deepEqual(raceForFirst.words, raceForSecond.words);
        assert.ok(raceForFirst.startsInMs >= 0);
        assert.equal(multiplayer.state.rooms.size, 1);

        first.close();
        first = await connect(url, signToken('user_one'));
        const resumed = await emitAck(first, 'match:resume', firstMatch.roomId);
        assert.equal(resumed.room.roomId, firstMatch.roomId);
        assert.equal(resumed.room.state, 'racing');

        await new Promise((resolve) => setTimeout(resolve, raceForFirst.startsInMs + 750));
        // Home-page stats count: each completed word includes its trailing space.
        const firstThreeChars = raceForFirst.words.slice(0, 3)
            .reduce((total, word) => total + word.length, 0) + 3;
        await emitAck(first, 'race:progress', [firstMatch.roomId, 1, 3, firstThreeChars, 0]);
        const duplicate = await emitAck(first, 'race:progress', [firstMatch.roomId, 1, 3, firstThreeChars, 0]);
        assert.equal(duplicate.duplicate, true);
    } finally {
        if (first) first.close();
        if (second) second.close();
        multiplayer.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('custom room lobby: min ready and host leave', { timeout: 20_000 }, async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    const multiplayer = createMultiplayerServer(server, {
        root: require('node:path').resolve(__dirname, '..'),
        env: {
            NODE_ENV: 'test',
            CLERK_JWT_KEY: TEST_PUBLIC_KEY,
            CLERK_SECRET_KEY: 'sk_test_local',
            ALLOW_UNVERIFIED_FRIENDS: 'true',
            MAX_BURST_WPM: '500',
            MAX_SUSTAINED_WPM: '400',
        },
        logger: { info() {}, warn() {} },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    let host;
    let guest;
    let guest2;

    try {
        host = await connect(url, signToken('room_host'));
        guest = await connect(url, signToken('room_guest_a'));
        guest2 = await connect(url, signToken('room_guest_b'));

        const created = await emitAck(host, 'room:create', {
            name: 'Test Room',
            maxPlayers: 8,
            config: { mode: 'words', amount: 25, lang: 'english' },
        });
        await emitAck(host, 'match:join', created.roomId);
        await emitAck(guest, 'room:join-code', created.roomCode);
        await emitAck(guest, 'match:join', created.roomId);
        await emitAck(guest2, 'room:join-code', created.roomCode);
        await emitAck(guest2, 'match:join', created.roomId);

        await emitAck(host, 'room:ready', created.roomId);
        await assert.rejects(
            emitAck(host, 'room:start', { roomId: created.roomId }),
            /not_enough_ready/,
        );

        await emitAck(guest, 'room:ready', created.roomId);
        await assert.rejects(
            emitAck(host, 'room:start', { roomId: created.roomId }),
            /players_not_ready|not_enough_ready/,
        );

        await emitAck(guest2, 'room:ready', created.roomId);
        const countdown = once(host, 'race:countdown');
        await emitAck(host, 'room:start', { roomId: created.roomId });
        const tick = await countdown;
        assert.equal(tick[0], created.roomId);

        await emitAck(host, 'race:leave', created.roomId);

        const room2 = await emitAck(host, 'room:create', {
            name: 'Close Me',
            maxPlayers: 8,
            config: { mode: 'time', amount: 30, lang: 'english' },
        });
        await emitAck(host, 'match:join', room2.roomId);
        await emitAck(guest, 'room:join-code', room2.roomCode);
        await emitAck(guest, 'match:join', room2.roomId);
        const closed = once(guest, 'room:closed');
        await emitAck(host, 'race:leave', room2.roomId);
        const closedPayload = await closed;
        assert.equal(closedPayload[0], room2.roomId);
        assert.equal(closedPayload[1], 'host-left');
    } finally {
        if (host) host.close();
        if (guest) guest.close();
        if (guest2) guest2.close();
        multiplayer.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
