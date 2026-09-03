/**
 * Compatibility facade for the Friends page dual controls.
 * Real state lives only in the Cloudflare multiplayer client.
 */
(function () {
    'use strict';

    var current = null;
    var autoJoinBotMatch = false;

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

    function dispatchChallengePending() {
        try {
            window.dispatchEvent(new CustomEvent('usertypo:dual:challenge-pending', {
                detail: current && current.mode === 'challenge' && current.status === 'pending'
                    ? { userId: current.targetUserId }
                    : { userId: '' },
            }));
        } catch (_) { /* ignore */ }
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
                body: 'Searching for an online opponent…',
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
        dispatchChallengePending();
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
        dispatchChallengePending();
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
            dispatchChallengePending();
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
                    body: 'Searching for an online opponent…',
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
        autoJoinBotMatch = false;
        if (previous && previous.mode === 'matchmaking' && (previous.status === 'searching' || previous.status === 'awaiting-choice')) {
            await api().cancelPublicDuel();
        } else if (previous && previous.mode === 'challenge' && previous.status === 'pending' && previous.inviteId) {
            await api().cancelChallenge(previous.inviteId);
        }
        if (current === previous) current = null;
        clearPendingIndicator(previous && previous.pendingId);
        dispatchChallengePending();
    }

    async function continueSearching() {
        if (!current || current.mode !== 'matchmaking' || !current.listingId) {
            throw new Error('No active dual search.');
        }
        await api().extendPublicDuelSearch(current.listingId);
        current.status = 'searching';
        showPendingIndicator({
            id: current.pendingId || pendingId(current.listingId),
            title: 'Looking for a match',
            body: 'Searching for an online opponent…',
            cancelLabel: 'Cancel search',
        });
    }

    async function playAgainstBot() {
        if (!current || current.mode !== 'matchmaking' || !current.listingId) {
            throw new Error('No active dual search.');
        }
        var raceConfig = current.config;
        clearPendingIndicator(current.pendingId);
        autoJoinBotMatch = false;
        try {
            await api().cancelPublicDuel();
        } catch (_) {
            // Offline or listing already cleared — local bot race does not need the server.
        }
        try {
            sessionStorage.setItem('usertypo:local-bot-config', JSON.stringify(raceConfig));
        } catch (_) { /* ignore */ }
        current = { mode: 'bot', status: 'ready', local: true, config: raceConfig };
        if (typeof window.navigateTo === 'function') {
            window.navigateTo('/dual?local=bot');
        } else {
            window.location.href = '/dual?local=bot';
        }
    }

    function showNoPlayersFound(payload) {
        var listingId = payload && payload.listingId;
        if (!listingId) return;
        if (!current || current.listingId !== listingId) {
            current = {
                mode: 'matchmaking',
                status: 'awaiting-choice',
                listingId: listingId,
                config: payload.config,
                pendingId: pendingId(listingId),
            };
        } else {
            current.status = 'awaiting-choice';
        }
        clearPendingIndicator(current.pendingId);
        if (!window.usertypoNotifications?.addEphemeral) return;
        window.usertypoNotifications.addEphemeral({
            id: 'duel-no-players:' + listingId,
            type: 'duel_notice',
            title: 'No players found',
            body: 'Would you like to keep searching or play against a bot?',
            data: { listingId: listingId },
            _actions: [
                {
                    label: 'Continue searching',
                    tone: 'primary',
                    resolve: false,
                    run: function () { return continueSearching(); },
                },
                {
                    label: 'Play against a bot',
                    tone: 'neutral',
                    resolve: false,
                    run: function () { return playAgainstBot(); },
                },
                {
                    label: 'Cancel',
                    tone: 'danger',
                    resolve: false,
                    run: function () { return clearRequest(); },
                },
            ],
        }, { toast: true });
    }

    window.addEventListener('usertypo:multiplayer:match-ready', function (event) {
        var match = event.detail || {};
        clearPendingIndicator(current && current.pendingId);
        current = { mode: match.reason || 'match', status: 'ready', roomId: match.roomId, config: match.config };
        dispatchChallengePending();
    });
    window.addEventListener('usertypo:multiplayer:rejected', function () {
        clearPendingIndicator(current && current.pendingId);
        current = null;
        dispatchChallengePending();
    });
    window.addEventListener('usertypo:multiplayer:expired', function () {
        clearPendingIndicator(current && current.pendingId);
        current = null;
        dispatchChallengePending();
    });
    window.addEventListener('usertypo:multiplayer:search-timeout', function (event) {
        showNoPlayersFound(event.detail || {});
    });
    window.addEventListener('usertypo:multiplayer:ready', function (event) {
        restoreSearch(event.detail);
    });
    try { restoreSearch(api().getReadyState()); } catch (_) { /* guest */ }

    window.DualMatch = {
        sendRequest: sendRequest,
        sendMatchmaking: sendMatchmaking,
        clearRequest: clearRequest,
        continueSearching: continueSearching,
        playAgainstBot: playAgainstBot,
        consumeAutoJoinBotMatch: function () {
            var value = autoJoinBotMatch;
            autoJoinBotMatch = false;
            return value;
        },
        loadRequest: function () { return current; },
        getPendingChallengeUserId: function () {
            return current && current.mode === 'challenge' && current.status === 'pending'
                ? current.targetUserId
                : '';
        },
        getPhase: function () { return current ? current.status : 'none'; },
        refresh: function () {},
        _stopTicker: function () {},
        _resetJoining: function () {},
        version: 9,
    };
})();
