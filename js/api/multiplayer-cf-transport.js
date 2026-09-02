/**
 * Cloudflare WebSocket transport for usertypo_ multiplayer.
 * Socket.IO-compatible surface used by js/api/multiplayer.js on dev (workers.dev).
 *
 * Dual connection:
 *   - Lobby DO  → /ws              (matchmaking, listings, challenges, presence)
 *   - Race DO   → /ws?room=<id>    (one Durable Object per duel)
 */
(function (global) {
    'use strict';

    function baseHttpUrl() {
        var cfg = global.USERTYPO_CONFIG || {};
        return String((cfg.multiplayer && cfg.multiplayer.url) || '').replace(/\/+$/, '');
    }

    function wsLobbyUrl() {
        var raw = baseHttpUrl();
        if (!raw) return '';
        if (raw.startsWith('https://')) return raw.replace(/^https:/, 'wss:') + '/ws';
        if (raw.startsWith('http://')) return raw.replace(/^http:/, 'ws:') + '/ws';
        return raw + '/ws';
    }

    function wsRaceUrl(roomId) {
        var lobby = wsLobbyUrl();
        if (!lobby || !roomId) return '';
        var join = lobby.indexOf('?') >= 0 ? '&' : '?';
        return lobby + join + 'room=' + encodeURIComponent(String(roomId));
    }

    function isRaceEvent(event) {
        var e = String(event || '');
        return e.indexOf('match:') === 0 || e.indexOf('race:') === 0;
    }

    function createCfSocket(options) {
        var lobbyWs = null;
        var raceWs = null;
        var raceRoomId = '';
        var lobbyConnected = false;
        var raceConnected = false;
        var lobbyReady = false;
        var raceReady = false;
        var active = false;
        var id = 'cf-' + Math.random().toString(36).slice(2, 10);
        var handlers = Object.create(null);
        var pendingAcks = Object.create(null);
        var ackSeq = 0;
        var raceConnectPromise = null;

        function on(event, fn) {
            if (!handlers[event]) handlers[event] = [];
            handlers[event].push(fn);
        }

        function once(event, fn) {
            function wrapper() {
                off(event, wrapper);
                fn.apply(null, arguments);
            }
            on(event, wrapper);
        }

        function off(event, fn) {
            if (!handlers[event]) return;
            handlers[event] = handlers[event].filter(function (f) { return f !== fn; });
        }

        function emitLocal(event, payload) {
            var list = handlers[event];
            if (!list) return;
            list.slice().forEach(function (fn) {
                try { fn(payload); } catch (e) { console.warn('[multiplayer-cf]', event, e); }
            });
        }

        function sendOn(ws, obj) {
            if (!ws || ws.readyState !== 1) return false;
            ws.send(JSON.stringify(obj));
            return true;
        }

        function handleMessage(raw) {
            var msg;
            try { msg = JSON.parse(raw); } catch (_) { return; }
            if (msg.t === 'ev' && msg.e) {
                if (msg.e === 'duel:ready' && msg.p && msg.p.roomId) {
                    ensureRaceConnected(String(msg.p.roomId)).catch(function () { /* joinMatch will retry */ });
                }
                emitLocal(msg.e, msg.p);
                return;
            }
            if (msg.t === 'ack' && msg.id) {
                var pending = pendingAcks[msg.id];
                if (!pending) return;
                delete pendingAcks[msg.id];
                clearTimeout(pending.timer);
                pending.fn(msg);
            }
        }

        function openSocket(url) {
            return new Promise(function (resolve, reject) {
                var settled = false;
                var connectTimer = null;
                var localReady = false;
                var socket = new WebSocket(url);

                function finish(err) {
                    if (settled) return;
                    settled = true;
                    if (connectTimer) clearTimeout(connectTimer);
                    if (err) reject(err);
                    else resolve(socket);
                }

                function onReady() {
                    localReady = true;
                    finish(null);
                }

                socket.addEventListener('open', function () {
                    var auth = options && options.auth;
                    if (typeof auth === 'function') {
                        auth(function (payload) {
                            if (payload && payload.authError) {
                                finish(new Error(String(payload.authError)));
                                try { socket.close(); } catch (_) { /* ignore */ }
                                return;
                            }
                            try {
                                socket.send(JSON.stringify({ t: 'auth', p: payload || {} }));
                            } catch (e) {
                                finish(e instanceof Error ? e : new Error('auth_send_failed'));
                            }
                        });
                    } else {
                        try {
                            socket.send(JSON.stringify({
                                t: 'auth',
                                p: (auth && typeof auth === 'object') ? auth : {},
                            }));
                        } catch (e) {
                            finish(e instanceof Error ? e : new Error('auth_send_failed'));
                        }
                    }
                });

                socket.addEventListener('message', function (ev) {
                    var raw = String(ev.data || '');
                    var msg;
                    try { msg = JSON.parse(raw); } catch (_) { return; }
                    if (msg.t === 'ev' && msg.e === 'multiplayer:ready' && !localReady) {
                        onReady();
                    }
                    handleMessage(raw);
                });

                socket.addEventListener('close', function () {
                    if (!settled) finish(new Error('WebSocket closed before ready.'));
                });

                socket.addEventListener('error', function () {
                    if (!settled) finish(new Error('WebSocket connection failed.'));
                });

                connectTimer = setTimeout(function () {
                    finish(new Error('WebSocket connection timed out.'));
                }, 20_000);
            });
        }

        function closeRace() {
            raceRoomId = '';
            raceReady = false;
            raceConnected = false;
            raceConnectPromise = null;
            if (raceWs) {
                try { raceWs.close(); } catch (_) { /* ignore */ }
                raceWs = null;
            }
        }

        function ensureRaceConnected(roomId) {
            roomId = String(roomId || '').trim();
            if (!roomId) return Promise.reject(new Error('missing_room'));
            if (raceWs && raceConnected && raceReady && raceRoomId === roomId) {
                return Promise.resolve(raceWs);
            }
            if (raceConnectPromise && raceRoomId === roomId) return raceConnectPromise;

            if (raceWs && raceRoomId !== roomId) closeRace();

            raceRoomId = roomId;
            var url = wsRaceUrl(roomId);
            if (!url) return Promise.reject(new Error('Multiplayer URL is not configured.'));

            raceConnectPromise = openSocket(url).then(function (socket) {
                raceWs = socket;
                raceConnected = true;
                raceReady = true;
                socket.addEventListener('close', function () {
                    if (raceWs === socket) {
                        raceConnected = false;
                        raceReady = false;
                        raceWs = null;
                        raceConnectPromise = null;
                    }
                });
                return socket;
            }).catch(function (err) {
                raceConnectPromise = null;
                raceConnected = false;
                raceReady = false;
                raceWs = null;
                throw err;
            });

            return raceConnectPromise;
        }

        function connect() {
            if (active && lobbyConnected && lobbyReady) return Promise.resolve();
            var url = wsLobbyUrl();
            if (!url) return Promise.reject(new Error('Multiplayer URL is not configured.'));
            active = true;
            return openSocket(url).then(function (socket) {
                lobbyWs = socket;
                lobbyConnected = true;
                lobbyReady = true;
                emitLocal('connect', null);
                socket.addEventListener('close', function () {
                    if (lobbyWs === socket) {
                        lobbyConnected = false;
                        lobbyReady = false;
                        lobbyWs = null;
                        emitLocal('disconnect', 'transport close');
                    }
                });
            });
        }

        function disconnect() {
            active = false;
            lobbyConnected = false;
            lobbyReady = false;
            closeRace();
            if (lobbyWs) {
                try { lobbyWs.close(); } catch (_) { /* ignore */ }
                lobbyWs = null;
            }
        }

        function pickSocketForEvent(event) {
            if (isRaceEvent(event)) return raceWs;
            return lobbyWs;
        }

        function roomIdFromPayload(event, payload) {
            if (event === 'match:join' || event === 'match:resume' || event === 'race:leave' || event === 'race:rematch') {
                return String(payload || '');
            }
            if (Array.isArray(payload) && payload[0]) return String(payload[0]);
            if (payload && typeof payload === 'object' && payload.roomId) return String(payload.roomId);
            return raceRoomId || '';
        }

        function emit(event, payload, ack) {
            function sendWithAck(ws) {
                if (typeof ack === 'function') {
                    var reqId = String(++ackSeq);
                    var timer = setTimeout(function () {
                        delete pendingAcks[reqId];
                        ack({ ok: false, error: 'timeout' });
                    }, 8000);
                    pendingAcks[reqId] = { fn: ack, timer: timer };
                    if (!sendOn(ws, { t: 'req', id: reqId, e: event, p: payload })) {
                        clearTimeout(timer);
                        delete pendingAcks[reqId];
                        ack({ ok: false, error: 'offline' });
                    }
                    return;
                }
                sendOn(ws, { t: 'emit', e: event, p: payload });
            }

            if (!isRaceEvent(event)) {
                sendWithAck(lobbyWs);
                return;
            }

            var roomId = roomIdFromPayload(event, payload);
            ensureRaceConnected(roomId).then(function (ws) {
                sendWithAck(ws);
            }).catch(function (err) {
                if (typeof ack === 'function') {
                    ack({ ok: false, error: (err && err.message) || 'race_connect_failed' });
                }
            });
        }

        var socket = {
            id: id,
            connected: false,
            active: false,
            volatile: {
                emit: function (event, payload) { emit(event, payload); },
            },
            on: on,
            once: once,
            off: off,
            emit: emit,
            connect: connect,
            disconnect: disconnect,
            ensureRaceConnected: ensureRaceConnected,
            closeRace: closeRace,
        };

        Object.defineProperty(socket, 'connected', {
            get: function () { return lobbyConnected || raceConnected; },
        });
        Object.defineProperty(socket, 'active', {
            get: function () { return active; },
        });

        return socket;
    }

    global.usertypoMultiplayerCf = {
        createSocket: createCfSocket,
        wsBaseUrl: wsLobbyUrl,
        isCloudflareUrl: function (url) {
            var u = String(url || '').toLowerCase();
            return u.includes('.workers.dev') || u.includes('usertypo-mp');
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
