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

    function pendingId(value) {
        return value ? 'dual-pending:' + value : 'dual-pending';
    }

    function showPendingIndicator(options) {
        if (!window.usertypoNotifications?.showPending) return;
        window.usertypoNotifications.showPending(Object.assign({}, options, {
            onCancel: clearRequest,
        }));
    }

    function clearPendingIndicator(id) {
        window.usertypoNotifications?.resolvePending(id || null);
    }

    function restoreSearch(state) {
        var search = state && state.search;
        if (current) return;
        if (search) {
            current = {
                mode: 'matchmaking',
                status: 'searching',
                config: search.config,
                listingId: search.listingId,
                pendingId: pendingId(search.listingId),
            };
            showPendingIndicator({
                id: current.pendingId,
                title: 'Looking for a match',
                body: 'A bot will join after 30 seconds',
                cancelLabel: 'Cancel search',
            });
            return;
        }
        var challenge = state && Array.isArray(state.outgoingChallenges)
            ? state.outgoingChallenges[0]
            : null;
        if (!challenge) return;
        current = {
            mode: 'challenge',
            status: 'pending',
            targetUserId: challenge.targetUserId,
            targetName: challenge.targetName,
            config: challenge.config,
            inviteId: challenge.inviteId,
            pendingId: pendingId(challenge.inviteId),
        };
        showPendingIndicator({
            id: current.pendingId,
            title: 'Waiting for ' + current.targetName,
            body: api().describeConfig(current.config) + ' · Waiting for a response',
            cancelLabel: 'Cancel request',
        });
    }

    async function sendRequest(target, config) {
        var userId = typeof target === 'object' && target ? target.userId : target;
        var targetName = typeof target === 'object' && target ? target.name : '';
        if (!userId) throw new Error('Select an online friend.');
        if (current && current.status === 'searching') {
            throw new Error('Cancel your current dual search before challenging a friend.');
        }
        if (current && current.mode === 'challenge' && current.status === 'pending') {
            throw new Error('Cancel your pending dual request before sending another one.');
        }
        current = {
            mode: 'challenge',
            status: 'pending',
            targetUserId: userId,
            targetName: targetName || 'your friend',
            config: config,
        };
        try {
            var result = await api().sendChallenge(userId, config);
            current.inviteId = result.inviteId;
            current.pendingId = pendingId(result.inviteId);
            showPendingIndicator({
                id: current.pendingId,
                title: 'Waiting for ' + current.targetName,
                body: api().describeConfig(config) + ' · Waiting for a response',
                cancelLabel: 'Cancel request',
            });
            return result;
        } catch (error) {
            current = null;
            throw error;
        }
    }

    async function sendMatchmaking(config) {
        if (current && current.mode === 'matchmaking' && current.status === 'searching') {
            throw new Error('You cannot create a dual while already looking for a dual.');
        }
        if (current && current.mode === 'challenge' && current.status === 'pending') {
            throw new Error('Cancel your pending friend challenge before creating a dual.');
        }
        current = { mode: 'matchmaking', status: 'searching', config: config };
        try {
            var result = await api().createPublicDuel(config);
            if (result.roomId) current = { mode: 'matchmaking', status: 'matched', roomId: result.roomId, config: config };
            else {
                current.listingId = result.listingId;
                current.pendingId = pendingId(result.listingId);
                showPendingIndicator({
                    id: current.pendingId,
                    title: 'Looking for a match',
                    body: 'A bot will join after 30 seconds',
                    cancelLabel: 'Cancel search',
                });
            }
            return result;
        } catch (error) {
            current = null;
            throw error;
        }
    }

    async function clearRequest() {
        var previous = current;
        if (previous && previous.mode === 'matchmaking' && previous.status === 'searching') {
            await api().cancelPublicDuel();
        } else if (previous && previous.mode === 'challenge' && previous.status === 'pending' && previous.inviteId) {
            await api().cancelChallenge(previous.inviteId);
        }
        if (current === previous) current = null;
        clearPendingIndicator(previous && previous.pendingId);
    }

    window.addEventListener('usertypo:multiplayer:match-ready', function (event) {
        var match = event.detail || {};
        clearPendingIndicator(current && current.pendingId);
        current = { mode: match.reason || 'match', status: 'ready', roomId: match.roomId, config: match.config };
    });
    window.addEventListener('usertypo:multiplayer:rejected', function () {
        clearPendingIndicator(current && current.pendingId);
        current = null;
    });
    window.addEventListener('usertypo:multiplayer:expired', function () {
        clearPendingIndicator(current && current.pendingId);
        current = null;
    });
    window.addEventListener('usertypo:multiplayer:ready', function (event) {
        restoreSearch(event.detail);
    });
    restoreSearch(api().getReadyState());

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
