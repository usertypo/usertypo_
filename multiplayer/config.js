'use strict';

const LIMITS = Object.freeze({
    maxPlayersPerRoom: 8,
    maxActiveRooms: 250,
    maxPublicListings: 250,
    maxInvites: 500,
    maxPayloadBytes: 1024,
    maxEventsPerWindow: 80,
    rateWindowMs: 10_000,
    inviteTtlMs: 30_000,
    listingTtlMs: 30_000,
    joinTtlMs: 60_000,
    reconnectGraceMs: 5_000,
    finishedRoomTtlMs: 60_000,
    roomInactivityMs: 600_000,
    minReadyToStart: 3,
    countdownSeconds: 5,
    maxRetainedSnapshots: 32,
});

function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function normalizeConfig(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const allowedAmounts = [15, 30, 60, 120];
    const parsed = Number.parseInt(raw.amount, 10);
    let amount = 30;
    if (Number.isFinite(parsed)) {
        amount = allowedAmounts.reduce((best, value) => (
            Math.abs(value - parsed) < Math.abs(best - parsed) ? value : best
        ), allowedAmounts[0]);
    }
    const language = String(raw.lang || raw.language || 'english')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 64) || 'english';

    return Object.freeze({
        mode: 'time',
        amount,
        lang: language,
        punct: raw.punct === true || raw.punct === 1 || raw.punct === '1',
        nums: raw.nums === true || raw.nums === 1 || raw.nums === '1',
    });
}

function configKey(config) {
    return [
        config.mode,
        config.amount,
        config.lang,
        config.punct ? 1 : 0,
        config.nums ? 1 : 0,
    ].join(':');
}

module.exports = {
    LIMITS,
    clampInteger,
    normalizeConfig,
    configKey,
};
