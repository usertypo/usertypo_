'use strict';

const MIN_IDLE_MS = 10 * 60 * 1000;
const MAX_IDLE_MS = 14 * 60 * 1000;

function randomIdleDelay() {
    return MIN_IDLE_MS + Math.floor(Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS + 1));
}

function createKeepAwake(options) {
    const logger = options.logger || console;
    const enabled = options.enabled === true;
    const baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
    let timer = null;
    let pingInFlight = false;
    let lastRealActivityAt = Date.now();
    let targetIdleMs = randomIdleDelay();

    function clearTimer() {
        if (timer) clearTimeout(timer);
        timer = null;
    }

    function schedule() {
        clearTimer();
        if (!enabled || !baseUrl) return;
        const elapsed = Date.now() - lastRealActivityAt;
        const wait = Math.max(1000, targetIdleMs - elapsed);
        timer = setTimeout(runIfIdle, wait);
    }

    function recordActivity() {
        lastRealActivityAt = Date.now();
        targetIdleMs = randomIdleDelay();
        schedule();
    }

    async function runIfIdle() {
        const idleFor = Date.now() - lastRealActivityAt;
        if (idleFor < targetIdleMs || pingInFlight) {
            schedule();
            return;
        }

        pingInFlight = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(baseUrl + '/health-check', {
                method: 'GET',
                headers: { 'x-usertypo-self-ping': '1' },
                signal: controller.signal,
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            logger.info('[keep-awake] health check sent after %d seconds idle', Math.round(idleFor / 1000));
        } catch (error) {
            logger.warn('[keep-awake] self-ping failed:', error && error.message);
        } finally {
            clearTimeout(timeout);
            pingInFlight = false;
            lastRealActivityAt = Date.now();
            targetIdleMs = randomIdleDelay();
            schedule();
        }
    }

    function middleware(req, _res, next) {
        // Render's own health probes should not postpone the inactivity timer;
        // they do not represent real user traffic.
        if (req.path !== '/health-check' && req.headers['x-usertypo-self-ping'] !== '1') {
            recordActivity();
        }
        next();
    }

    function start() {
        if (enabled && baseUrl) {
            logger.info('[keep-awake] enabled; pings occur after a random 10–14 minutes of inactivity');
            schedule();
        }
    }

    function stop() {
        clearTimer();
    }

    return { middleware, recordActivity, start, stop };
}

module.exports = { createKeepAwake, randomIdleDelay };
