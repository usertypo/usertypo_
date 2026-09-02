/**
 * Cloudflare WebSocket transport for usertypo_ multiplayer.
 * Socket.IO-compatible surface used by js/api/multiplayer.js on dev (workers.dev).
 */
(function (global) {
    'use strict';

    function wsBaseUrl() {
        var cfg = global.USERTYPO_CONFIG || {};
        var raw = String((cfg.multiplayer && cfg.multiplayer.url) || '').replace(/\/+$/, '');
        if (!raw) return '';
        if (raw.startsWith('https://')) return raw.replace(/^https:/, 'wss:') + '/ws';
        if (raw.startsWith('http://')) return raw.replace(/^http:/, 'ws:') + '/ws';
        return raw + '/ws';
    }

    function createCfSocket(options) {
        var ws = null;
        var connected = false;
        var active = false;
        var readyStateReceived = false;
        var id = 'cf-' + Math.random().toString(36).slice(2, 10);
        var handlers = Object.create(null);
        var pendingAcks = Object.create(null);
        var ackSeq = 0;

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

        function sendJson(obj) {
            if (!ws || ws.readyState !== 1) return;
            ws.send(JSON.stringify(obj));
        }

        function handleMessage(raw) {
            var msg;
            try { msg = JSON.parse(raw); } catch (_) { return; }
            if (msg.t === 'ev' && msg.e) {
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

        function connect() {
            if (active && connected && readyStateReceived) return Promise.resolve();
            var url = wsBaseUrl();
            if (!url) return Promise.reject(new Error('Multiplayer URL is not configured.'));
            return new Promise(function (resolve, reject) {
                var settled = false;
                var connectTimer = null;
                function finish(err) {
                    if (settled) return;
                    settled = true;
                    if (connectTimer) clearTimeout(connectTimer);
                    if (err) reject(err);
                    else resolve();
                }
                active = true;
                readyStateReceived = false;
                ws = new WebSocket(url);
                ws.addEventListener('open', function () {
                    connected = true;
                    var auth = options && options.auth;
                    if (typeof auth === 'function') {
                        auth(function (payload) {
                            if (payload && payload.authError) {
                                finish(new Error(String(payload.authError)));
                                try { ws.close(); } catch (_) { /* ignore */ }
                                return;
                            }
                            sendJson({ t: 'auth', p: payload || {} });
                        });
                    } else {
                        sendJson({ t: 'auth', p: (auth && typeof auth === 'object') ? auth : {} });
                    }
                });
                ws.addEventListener('message', function (ev) {
                    handleMessage(String(ev.data || ''));
                });
                ws.addEventListener('close', function () {
                    connected = false;
                    readyStateReceived = false;
                    emitLocal('disconnect', 'transport close');
                });
                ws.addEventListener('error', function () {
                    if (!connected) finish(new Error('WebSocket connection failed.'));
                    emitLocal('connect_error', new Error('WebSocket error'));
                });
                once('multiplayer:ready', function () {
                    readyStateReceived = true;
                    finish(null);
                });
                connectTimer = setTimeout(function () {
                    if (!connected) {
                        finish(new Error('WebSocket connection timed out.'));
                        return;
                    }
                    finish(new Error('Multiplayer server did not respond.'));
                }, 20_000);
            });
        }

        function disconnect() {
            active = false;
            connected = false;
            readyStateReceived = false;
            if (ws) {
                try { ws.close(); } catch (_) { /* ignore */ }
                ws = null;
            }
        }

        function emit(event, payload, ack) {
            if (typeof ack === 'function') {
                var reqId = String(++ackSeq);
                pendingAcks[reqId] = {
                    fn: ack,
                    timer: setTimeout(function () {
                        delete pendingAcks[reqId];
                        ack({ ok: false, error: 'timeout' });
                    }, 8000),
                };
                sendJson({ t: 'req', id: reqId, e: event, p: payload });
                return;
            }
            sendJson({ t: 'emit', e: event, p: payload });
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
        };

        Object.defineProperty(socket, 'connected', {
            get: function () { return connected; },
        });
        Object.defineProperty(socket, 'active', {
            get: function () { return active; },
        });

        on('connect', function () {
            connected = true;
        });

        return socket;
    }

    global.usertypoMultiplayerCf = {
        createSocket: createCfSocket,
        wsBaseUrl: wsBaseUrl,
        isCloudflareUrl: function (url) {
            var u = String(url || '').toLowerCase();
            return u.includes('.workers.dev') || u.includes('usertypo-mp');
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
