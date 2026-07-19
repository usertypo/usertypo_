'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { io: createClient } = require('socket.io-client');
const { createMultiplayerServer } = require('../multiplayer/socket-server');

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function signToken(privateKey, userId) {
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
    const signature = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + payload), privateKey);
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

async function connect(url, token) {
    const socket = createClient(url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
    });
    await once(socket, 'multiplayer:ready');
    return socket;
}

test('matches authenticated players and starts one server-owned race', { timeout: 15_000 }, async () => {
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
    const server = http.createServer((_req, res) => res.end('ok'));
    const multiplayer = createMultiplayerServer(server, {
        root: require('node:path').resolve(__dirname, '..'),
        env: {
            NODE_ENV: 'test',
            CLERK_JWT_KEY: publicKey,
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
        first = await connect(url, signToken(keys.privateKey, 'user_one'));
        second = await connect(url, signToken(keys.privateKey, 'user_two'));
        const firstReady = once(first, 'duel:ready');
        const secondReady = once(second, 'duel:ready');

        const firstSearch = await emitAck(first, 'duel:create', {
            mode: 'words',
            amount: 10,
            lang: 'english',
        });
        assert.ok(firstSearch.listingId);
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
        first = await connect(url, signToken(keys.privateKey, 'user_one'));
        const resumed = await emitAck(first, 'match:resume', firstMatch.roomId);
        assert.equal(resumed.room.roomId, firstMatch.roomId);
        assert.equal(resumed.room.state, 'racing');

        await new Promise((resolve) => setTimeout(resolve, raceForFirst.startsInMs + 750));
        const firstThreeChars = raceForFirst.words.slice(0, 3)
            .reduce((total, word) => total + word.length, 0) + 2;
        await emitAck(first, 'race:progress', [firstMatch.roomId, 1, 3, firstThreeChars, 0]);
        const duplicate = await emitAck(first, 'race:progress', [firstMatch.roomId, 1, 3, firstThreeChars, 0]);
        assert.equal(duplicate.duplicate, true);
    } finally {
        if (first) first.close();
        if (second) second.close();
        multiplayer.close();
    }
});
