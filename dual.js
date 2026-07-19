/**
 * Compatibility facade for the Friends page dual controls.
 * Real state lives only in the multiplayer Socket.IO server/client.
 */
(function () {
    'use strict';

    var current = null;

    function api() {
        if (!window.usertypoMultiplayer) throw new Error('Multiplayer is not ready.');
        return window.usertypoMultiplayer;
    }

    async function sendRequest(target, config) {
        var userId = typeof target === 'object' && target ? target.userId : target;
        if (!userId) throw new Error('Select an online friend.');
        current = { mode: 'challenge', status: 'pending', targetUserId: userId, config: config };
        try {
            var result = await api().sendChallenge(userId, config);
            current.inviteId = result.inviteId;
            return result;
        } catch (error) {
            current = null;
            throw error;
        }
    }

    async function sendMatchmaking(config) {
        current = { mode: 'matchmaking', status: 'searching', config: config };
        try {
            var result = await api().createPublicDuel(config);
            if (result.roomId) current = { mode: 'matchmaking', status: 'matched', roomId: result.roomId, config: config };
            else current.listingId = result.listingId;
            return result;
        } catch (error) {
            current = null;
            throw error;
        }
    }

    async function clearRequest() {
        var previous = current;
        current = null;
        if (previous && previous.mode === 'matchmaking' && previous.status === 'searching') {
            try { await api().cancelPublicDuel(); } catch (_) { /* connection may already be gone */ }
        }
    }

    window.addEventListener('usertypo:multiplayer:match-ready', function (event) {
        var match = event.detail || {};
        current = { mode: match.reason || 'match', status: 'ready', roomId: match.roomId, config: match.config };
    });
    window.addEventListener('usertypo:multiplayer:rejected', function () {
        current = null;
    });
    window.addEventListener('usertypo:multiplayer:expired', function () {
        current = null;
    });

    window.DualMatch = {
        sendRequest: sendRequest,
        sendMatchmaking: sendMatchmaking,
        clearRequest: clearRequest,
        loadRequest: function () { return current; },
        getPhase: function () { return current ? current.status : 'none'; },
        refresh: function () {},
        _stopTicker: function () {},
        _resetJoining: function () {},
        version: 5,
    };
})();
