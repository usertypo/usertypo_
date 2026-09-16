/**
 * Friend online alerts — one summary toast on first website load only.
 * Public API: window.usertypoFriendOnlineNotify
 */
(function () {
    var started = false;
    var sessionActive = false;
    var wasSignedIn = null;
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

    async function onSignedIn() {
        if (sessionActive) return;
        sessionActive = true;
        await showOnlineSummaryIfAny();
    }

    function onSignedOut() {
        sessionActive = false;
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
                // Fresh sign-in this page load (do not reset summary if already shown).
                sessionActive = false;
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.usertypoFriendOnlineNotify = {
        start: start,
        formatOnlineTitle: formatOnlineTitle,
    };
})();
