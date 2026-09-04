/**
 * Cloudflare WebSocket transport for usertypo_ multiplayer.
 * Socket.IO-compatible client API over native WebSockets.
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
        if (e.indexOf('match:') === 0 || e.indexOf('race:') === 0) return true;
        return e === 'room:ready'
            || e === 'room:update-config'
            || e === 'room:add-bot'
            || e === 'room:remove-player'
            || e === 'room:start'
            || e === 'room:return-lobby';
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
        var raceReconnectTimer = null;
        var intentionalRaceClose = false;
        var lobbyConnectPromise = null;
        var lobbyReconnectTimer = null;
        var lobbyReconnectAttempt = 0;
        var intentionalLobbyClose = false;
        var lobbyHeartbeatTimer = null;
        var raceHeartbeatTimer = null;

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

        function handleMessage(raw, fromRace) {
            var msg;
            try { msg = JSON.parse(raw); } catch (_) { return; }
            if (msg.t === 'ev' && msg.e) {
                if (msg.e === 'duel:ready' && msg.p && msg.p.roomId) {
                    ensureRaceConnected(String(msg.p.roomId)).catch(function () { /* joinMatch will retry */ });
                }
                // Race sockets also emit multiplayer:ready — do not treat that as lobby ready.
                if (fromRace && msg.e === 'multiplayer:ready') {
                    emitLocal('race-socket-ready', msg.p);
                    return;
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

        function openSocket(url, opts) {
            var fromRace = !!(opts && opts.fromRace);
            var timeoutMs = (opts && opts.timeoutMs) || 20_000;
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
                    // Cloudflare DO auto-response keepalive (plain text).
                    if (raw === 'pong' || raw === 'ping') return;
                    var msg;
                    try { msg = JSON.parse(raw); } catch (_) { return; }
                    if (msg.t === 'ev' && msg.e === 'multiplayer:ready' && !localReady) {
                        onReady();
                    }
                    handleMessage(raw, fromRace);
                });

                socket.addEventListener('close', function () {
                    if (!settled) finish(new Error('WebSocket closed before ready.'));
                });

                socket.addEventListener('error', function () {
                    if (!settled) finish(new Error('WebSocket connection failed.'));
                });

                connectTimer = setTimeout(function () {
                    finish(new Error('WebSocket connection timed out.'));
                }, timeoutMs);
            });
        }

        function scheduleRaceReconnect() {
            if (intentionalRaceClose || !active || !raceRoomId) return;
            if (raceReconnectTimer) clearTimeout(raceReconnectTimer);
            var want = raceRoomId;
            raceReconnectTimer = setTimeout(function () {
                raceReconnectTimer = null;
                if (intentionalRaceClose || !active || raceRoomId !== want || raceConnected) return;
                ensureRaceConnected(want).catch(function () { /* next emit retries */ });
            }, 350);
        }

        function stopLobbyHeartbeat() {
            if (lobbyHeartbeatTimer) {
                clearInterval(lobbyHeartbeatTimer);
                lobbyHeartbeatTimer = null;
            }
        }

        function startLobbyHeartbeat() {
            stopLobbyHeartbeat();
            lobbyHeartbeatTimer = setInterval(function () {
                if (!lobbyWs || lobbyWs.readyState !== 1) return;
                try { lobbyWs.send('ping'); } catch (_) { /* ignore */ }
            }, 20_000);
        }

        function stopRaceHeartbeat() {
            if (raceHeartbeatTimer) {
                clearInterval(raceHeartbeatTimer);
                raceHeartbeatTimer = null;
            }
        }

        function startRaceHeartbeat() {
            stopRaceHeartbeat();
            raceHeartbeatTimer = setInterval(function () {
                if (!raceWs || raceWs.readyState !== 1) return;
                try { raceWs.send('ping'); } catch (_) { /* ignore */ }
            }, 20_000);
        }

        function scheduleLobbyReconnect() {
            if (intentionalLobbyClose || !active) return;
            if (lobbyReconnectTimer) clearTimeout(lobbyReconnectTimer);
            var delay = Math.min(10_000, 350 * Math.pow(2, Math.min(lobbyReconnectAttempt, 5)));
            lobbyReconnectAttempt += 1;
            lobbyReconnectTimer = setTimeout(function () {
                lobbyReconnectTimer = null;
                if (intentionalLobbyClose || !active) return;
                if (lobbyConnected && lobbyReady && lobbyWs && lobbyWs.readyState === 1) return;
                connect().catch(function () {
                    scheduleLobbyReconnect();
                });
            }, delay);
        }

        function isLobbyReady() {
            return !!(lobbyConnected && lobbyReady && lobbyWs && lobbyWs.readyState === 1);
        }

        function closeRace() {
            intentionalRaceClose = true;
            stopRaceHeartbeat();
            if (raceReconnectTimer) {
                clearTimeout(raceReconnectTimer);
                raceReconnectTimer = null;
            }
            raceRoomId = '';
            raceReady = false;
            raceConnected = false;
            raceConnectPromise = null;
            if (raceWs) {
                try { raceWs.close(); } catch (_) { /* ignore */ }
                raceWs = null;
            }
            intentionalRaceClose = false;
        }

        function ensureRaceConnected(roomId) {
            roomId = String(roomId || '').trim();
            if (!roomId) return Promise.reject(new Error('missing_room'));
            if (raceWs && raceConnected && raceReady && raceRoomId === roomId && raceWs.readyState === 1) {
                return Promise.resolve(raceWs);
            }
            if (raceConnectPromise && raceRoomId === roomId) return raceConnectPromise;

            if (raceWs && raceRoomId !== roomId) closeRace();

            intentionalRaceClose = false;
            raceRoomId = roomId;
            var url = wsRaceUrl(roomId);
            if (!url) return Promise.reject(new Error('Multiplayer URL is not configured.'));

            raceConnectPromise = openSocket(url, { fromRace: true, timeoutMs: 12_000 }).then(function (socket) {
                raceWs = socket;
                raceConnected = true;
                raceReady = true;
                startRaceHeartbeat();
                socket.addEventListener('close', function () {
                    if (raceWs === socket) {
                        stopRaceHeartbeat();
                        raceConnected = false;
                        raceReady = false;
                        raceWs = null;
                        raceConnectPromise = null;
                        scheduleRaceReconnect();
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
            if (isLobbyReady()) return Promise.resolve();
            if (lobbyConnectPromise) return lobbyConnectPromise;

            intentionalLobbyClose = false;
            active = true;
            var url = wsLobbyUrl();
            if (!url) return Promise.reject(new Error('Multiplayer URL is not configured.'));

            if (lobbyWs) {
                try { lobbyWs.close(); } catch (_) { /* ignore */ }
                lobbyWs = null;
            }
            lobbyConnected = false;
            lobbyReady = false;
            stopLobbyHeartbeat();

            lobbyConnectPromise = openSocket(url, { fromRace: false }).then(function (socket) {
                lobbyWs = socket;
                lobbyConnected = true;
                lobbyReady = true;
                lobbyReconnectAttempt = 0;
                lobbyConnectPromise = null;
                startLobbyHeartbeat();
                emitLocal('connect', null);
                socket.addEventListener('close', function () {
                    if (lobbyWs === socket) {
                        stopLobbyHeartbeat();
                        lobbyConnected = false;
                        lobbyReady = false;
                        lobbyWs = null;
                        lobbyConnectPromise = null;
                        emitLocal('disconnect', 'transport close');
                        scheduleLobbyReconnect();
                    }
                });
            }).catch(function (err) {
                lobbyConnectPromise = null;
                lobbyConnected = false;
                lobbyReady = false;
                lobbyWs = null;
                if (active && !intentionalLobbyClose) scheduleLobbyReconnect();
                throw err;
            });

            return lobbyConnectPromise;
        }

        function disconnect() {
            intentionalLobbyClose = true;
            active = false;
            lobbyConnected = false;
            lobbyReady = false;
            lobbyConnectPromise = null;
            lobbyReconnectAttempt = 0;
            stopLobbyHeartbeat();
            if (lobbyReconnectTimer) {
                clearTimeout(lobbyReconnectTimer);
                lobbyReconnectTimer = null;
            }
            closeRace();
            if (lobbyWs) {
                try { lobbyWs.close(); } catch (_) { /* ignore */ }
                lobbyWs = null;
            }
        }

        function roomIdFromPayload(event, payload) {
            if (
                event === 'match:join'
                || event === 'match:resume'
                || event === 'race:leave'
                || event === 'race:rematch'
                || event === 'room:ready'
                || event === 'room:return-lobby'
                || event === 'room:add-bot'
            ) {
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
            isRaceEvent: isRaceEvent,
            isLobbyReady: isLobbyReady,
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
        isRaceEvent: isRaceEvent,
        isCloudflareUrl: function (url) {
            var u = String(url || '').toLowerCase();
            return u.includes('.workers.dev') || u.includes('usertypo-mp');
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
