/**
 * Friends — search users, send/accept/decline/cancel requests, list friends.
 * Public API: window.usertypoFriends
 */
(function () {
    function rpcErrorMessage(err) {
        if (!err) return 'Unknown error';
        var msg = err.message || String(err);
        if (err.details) msg += ' — ' + err.details;
        if (err.hint) msg += ' (' + err.hint + ')';
        return msg;
    }

    function mapRpcError(err) {
        var raw = (err && err.message) ? String(err.message) : String(err || 'Unknown error');
        var code = '';
        var match = raw.match(/(?:ERROR:\s*)?(\w+)/i);
        code = match ? match[1] : '';

        var friendly = {
            already_friends: 'You are already friends with this user.',
            request_already_sent: 'Friend request already sent.',
            cannot_friend_self: 'You cannot add yourself.',
            user_not_found: 'User not found.',
            request_not_found: 'That friend request no longer exists.',
            friend_requests_disabled: 'This player is not accepting friend requests.',
            blocked_by_user: 'This player has blocked you.',
            you_blocked_user: 'Unblock this player before sending a friend request.',
            cannot_block_friend: 'Unfriend this player before blocking them.',
            forbidden: 'You cannot perform this action.',
            guest: 'Sign in to manage friends.',
            not_authenticated: 'Sign in to manage friends.',
        };

        if (friendly[code]) {
            return { error: err, code: code, message: friendly[code] };
        }
        if (/friend_requests_unique_pair|duplicate key/i.test(raw)) {
            return { error: err, code: 'duplicate_request', message: 'A friend request already exists for this user. Try again.' };
        }

        return {
            error: err,
            code: code,
            message: rpcErrorMessage(err),
        };
    }

    function emitFriendsChanged() {
        try {
            window.dispatchEvent(new CustomEvent('usertypo:friends-changed'));
        } catch (e) { /* ignore */ }
    }

    async function requireAuth() {
        if (!window.usertypoAuth || !window.usertypoDb) {
            throw new Error('auth_or_db_missing');
        }
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            throw new Error('guest');
        }
        return state.user;
    }

    async function getClient() {
        return window.usertypoDb.getClient();
    }

    async function searchUsers(query, limit) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('search_profiles', {
            p_query: String(query || '').trim(),
            p_limit: limit == null ? 10 : limit,
        });
        if (result.error) throw result.error;
        return result.data || [];
    }

    async function emitNotification(payload) {
        if (!window.usertypoNotifications || typeof window.usertypoNotifications.emitFriendNotification !== 'function') {
            return;
        }
        try {
            await window.usertypoNotifications.emitFriendNotification(payload);
        } catch (err) {
            console.warn('[usertypo friends] notification emit failed', err);
        }
    }

    async function sendRequest(toUserId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('send_friend_request', {
            p_to_user_id: toUserId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        var requestId = result.data;
        if (requestId) {
            await emitNotification({ type: 'friend_request', request_id: requestId });
        }
        return { requestId: requestId };
    }

    async function acceptRequest(requestId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('accept_friend_request', {
            p_request_id: requestId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        if (requestId) {
            await emitNotification({ type: 'friend_accepted', request_id: requestId });
        }
        return { ok: true };
    }

    async function declineRequest(requestId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('decline_friend_request', {
            p_request_id: requestId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        return { ok: true };
    }

    async function cancelRequest(requestId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('cancel_friend_request', {
            p_request_id: requestId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        return { ok: true };
    }

    async function removeFriend(friendUserId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('remove_friend', {
            p_friend_user_id: friendUserId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        return { ok: true };
    }

    async function blockUser(userId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('block_user', {
            p_user_id: userId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        return { ok: true };
    }

    async function unblockUser(userId) {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('unblock_user', {
            p_user_id: userId,
        });
        if (result.error) throw result.error;
        emitFriendsChanged();
        return { ok: true };
    }

    async function listBlockedUsers() {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('get_my_blocked_users');
        if (result.error) throw result.error;
        var data = result.data;
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return []; }
        }
        return [];
    }

    async function loadDashboard() {
        await requireAuth();
        var client = await getClient();
        var result = await client.rpc('get_friends_dashboard');
        if (result.error) throw result.error;

        var data = result.data || {};
        return {
            friends: Array.isArray(data.friends) ? data.friends : [],
            incoming: Array.isArray(data.incoming) ? data.incoming : [],
            outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
        };
    }

    window.usertypoFriends = {
        searchUsers: searchUsers,
        sendRequest: sendRequest,
        acceptRequest: acceptRequest,
        declineRequest: declineRequest,
        cancelRequest: cancelRequest,
        removeFriend: removeFriend,
        blockUser: blockUser,
        unblockUser: unblockUser,
        listBlockedUsers: listBlockedUsers,
        loadDashboard: loadDashboard,
        mapRpcError: mapRpcError,
    };
})();
