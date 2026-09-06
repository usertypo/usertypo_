/**
 * Friend online alerts — page-load summary + live offline→online notifications.
 * Public API: window.usertypoFriendOnlineNotify
 */
(function () {
    var nativeSetInterval = window.setInterval.bind(window);
    var nativeClearInterval = window.clearInterval.bind(window);

    var POLL_MS = 15000;

    var pollTimer = null;
    var started = false;
    var sessionActive = false;
    var wasSignedIn = null;
    var onlineMap = {};
    var mapSeeded = false;
    var checkInFlight = false;
    var summaryShownThisLoad = false;

    function friendLabel(friend) {
        if (window.usertypoProfiles && typeof window.usertypoProfiles.publicUsername === 'function') {
            return window.usertypoProfiles.publicUsername(friend, 'Player');
        }
        var display = String((friend && friend.display_name) || '').trim();
        if (display) return display;
        var username = String((friend && friend.username) || '').trim();
        if (username) return username;
        return 'Player';
    }

    /** English list: "A is online" / "A and B are online" / "A, B, and C are online" */
    function formatOnlineTitle(names) {
        var list = (names || []).map(function (n) { return String(n || '').trim(); }).filter(Boolean);
        if (!list.length) return '';
        if (list.length === 1) return list[0] + ' is online';
        if (list.length === 2) return list[0] + ' and ' + list[1] + ' are online';
        var head = list.slice(0, -1).join(', ');
        return head + ', and ' + list[list.length - 1] + ' are online';
    }

    function buildOnlineMap(friends) {
        var next = {};
        (friends || []).forEach(function (f) {
            if (!f || !f.user_id) return;
            next[String(f.user_id)] = {
                online: !!f.is_online,
                label: friendLabel(f),
            };
        });
        return next;
    }

    async function persistOnlineNotice(title, data) {
        if (!title) return;
        if (!window.usertypoNotifications) return;
        if (typeof window.usertypoNotifications.emitFriendOnlineNotification === 'function') {
            await window.usertypoNotifications.emitFriendOnlineNotification({
                type: 'friend_online',
                title: title,
                body: '',
                data: data || {},
            });
            return;
        }
        if (typeof window.usertypoNotifications.addEphemeral === 'function') {
            window.usertypoNotifications.addEphemeral({
                type: 'friend_online',
                title: title,
                body: '',
                data: data || {},
            });
        }
    }

    /** Once per full page load: toast + save who's currently online. */
    async function showOnlineSummaryIfAny() {
        if (summaryShownThisLoad) return;
        summaryShownThisLoad = true;
        try {
            if (!window.usertypoFriends) return;
            var dash = await window.usertypoFriends.loadDashboard();
            var friends = (dash && dash.friends) || [];
            onlineMap = buildOnlineMap(friends);
            mapSeeded = true;

            var online = friends.filter(function (f) { return f && f.is_online; });
            if (!online.length) return;

            var names = online.map(friendLabel);
            var title = formatOnlineTitle(names);
            if (!title) return;

            await persistOnlineNotice(title, {
                kind: 'load_summary',
                friend_user_ids: online.map(function (f) { return f.user_id; }),
                names: names,
            });
        } catch (err) {
            console.warn('[usertypo friend-online] load summary failed', err);
        }
    }

    async function seedMapWithoutNotify() {
        try {
            if (!window.usertypoFriends) return;
            var dash = await window.usertypoFriends.loadDashboard();
            onlineMap = buildOnlineMap((dash && dash.friends) || []);
            mapSeeded = true;
        } catch (err) {
            console.warn('[usertypo friend-online] seed failed', err);
        }
    }

    async function pollPresence() {
        if (checkInFlight) return;
        if (!window.usertypoAuth) return;
        var state = window.usertypoAuth.getState();
        if (!state || !state.isSignedIn || !state.user) return;
        if (!window.usertypoFriends) return;

        checkInFlight = true;
        try {
            var dash = await window.usertypoFriends.loadDashboard();
            var friends = (dash && dash.friends) || [];
            var nextMap = buildOnlineMap(friends);

            if (mapSeeded) {
                var newlyOnline = [];
                friends.forEach(function (f) {
                    if (!f || !f.user_id || !f.is_online) return;
                    var id = String(f.user_id);
                    var prev = onlineMap[id];
                    if (!prev || !prev.online) newlyOnline.push(f);
                });

                for (var i = 0; i < newlyOnline.length; i++) {
                    var friend = newlyOnline[i];
                    var label = friendLabel(friend);
                    var title = formatOnlineTitle([label]);
                    if (!title) continue;
                    await persistOnlineNotice(title, {
                        kind: 'came_online',
                        friend_user_id: friend.user_id,
                        names: [label],
                    });
                }
            }

            onlineMap = nextMap;
            mapSeeded = true;
        } catch (err) {
            console.warn('[usertypo friend-online] poll failed', err);
        } finally {
            checkInFlight = false;
        }
    }

    function stopPolling() {
        if (pollTimer) {
            nativeClearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function startPolling() {
        stopPolling();
        pollTimer = nativeSetInterval(function () {
            pollPresence();
        }, POLL_MS);
    }

    async function onSignedIn() {
        if (sessionActive) return;
        sessionActive = true;
        await showOnlineSummaryIfAny();
        if (!mapSeeded) await seedMapWithoutNotify();
        startPolling();
    }

    function onSignedOut() {
        sessionActive = false;
        stopPolling();
        onlineMap = {};
        mapSeeded = false;
    }

    function bindAuth() {
        if (!window.usertypoAuth) return;
        window.usertypoAuth.onChange(function (state) {
            var signedIn = !!(state && state.isSignedIn && state.user);
            if (wasSignedIn === null) {
                wasSignedIn = signedIn;
                if (signedIn) onSignedIn();
                return;
            }

            if (signedIn && !wasSignedIn) {
                sessionActive = false;
                summaryShownThisLoad = false;
                onSignedIn();
            } else if (!signedIn && wasSignedIn) {
                onSignedOut();
            }
            wasSignedIn = signedIn;
        });
    }

    function start() {
        if (started) return;
        started = true;

        if (!window.usertypoAuth) return;
        window.usertypoAuth.ready().then(function () {
            bindAuth();
        });

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            var s = window.usertypoAuth && window.usertypoAuth.getState();
            if (s && s.isSignedIn && s.user) pollPresence();
        });

        window.addEventListener('usertypo:friends-changed', function () {
            var s = window.usertypoAuth && window.usertypoAuth.getState();
            if (s && s.isSignedIn && s.user) pollPresence();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.usertypoFriendOnlineNotify = {
        start: start,
        formatOnlineTitle: formatOnlineTitle,
        poll: pollPresence,
    };
})();
