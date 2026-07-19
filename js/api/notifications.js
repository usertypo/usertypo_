/**
 * Notifications — load, mark read, polling toasts, unread badges.
 * Public API: window.usertypoNotifications
 */
(function () {
    // Capture natives before SPA pages wrap setInterval/clearInterval.
    var nativeSetInterval = window.setInterval.bind(window);
    var nativeClearInterval = window.clearInterval.bind(window);
    var nativeSetTimeout = window.setTimeout.bind(window);
    var nativeClearTimeout = window.clearTimeout.bind(window);

    var cached = [];
    var unreadCount = 0;
    var channel = null;
    var started = false;
    var knownIds = {};
    var pollTimer = null;
    var toastHideTimer = null;
    var pendingCollapseTimer = null;
    var pendingIndicatorId = null;
    var POLL_MS = 2000;

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function relativeTime(iso) {
        if (!iso) return '';
        var then = new Date(iso).getTime();
        if (!isFinite(then)) return '';
        var diff = Math.max(0, Date.now() - then);
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        return Math.floor(hours / 24) + 'd ago';
    }

    function notifyFriendsChanged() {
        try {
            window.dispatchEvent(new CustomEvent('usertypo:friends-changed'));
        } catch (e) { /* ignore */ }
    }

    async function requireAuth() {
        if (!window.usertypoAuth || !window.usertypoDb) throw new Error('auth_or_db_missing');
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) throw new Error('guest');
        return state.user;
    }

    function updateBadges() {
        var hasUnread = unreadCount > 0;
        var menuDot = document.getElementById('menu-unread-dot');
        if (menuDot) menuDot.classList.toggle('hidden', !hasUnread);
        var bellDot = document.getElementById('notifications-bell-dot');
        if (bellDot) bellDot.classList.toggle('hidden', !hasUnread);
        try {
            window.dispatchEvent(new CustomEvent('usertypo:notifications-changed', {
                detail: { unreadCount: unreadCount, notifications: cached },
            }));
        } catch (e) { /* ignore */ }
    }

    /** Same bottom-right toast used for "Changes saved" / failed tests. */
    function hideToast() {
        var toast = document.getElementById('save-toast');
        var actions = document.getElementById('save-toast-actions');
        if (!toast) return;
        toast.classList.remove('visible');
        toast.style.opacity = '0';
        toast.style.pointerEvents = 'none';
        if (actions) actions.classList.add('hidden');
    }

    function showToast(notificationOrMessage, iconName) {
        var toast = document.getElementById('save-toast');
        var msg = document.getElementById('toast-msg');
        var icon = document.getElementById('toast-icon');
        var actions = document.getElementById('save-toast-actions');
        var acceptBtn = document.getElementById('toast-accept-btn');
        var declineBtn = document.getElementById('toast-decline-btn');
        if (!toast || !msg || !icon) return;

        var notification = (typeof notificationOrMessage === 'object' && notificationOrMessage) ? notificationOrMessage : null;
        var text = notification
            ? (notification.title || 'Notification')
            : String(notificationOrMessage || 'Notification');
        var iconText = iconName || 'notifications';
        if (notification) {
            if (notification.type === 'friend_accepted') iconText = 'check_circle';
            else if (notification.type === 'friend_request') iconText = 'person_add';
        }

        msg.textContent = text;
        icon.textContent = iconText;
        if (iconText === 'error' || iconText === 'cancel') {
            icon.className = 'material-symbols-outlined text-error text-[18px] shrink-0';
        } else {
            icon.className = 'material-symbols-outlined text-primary text-[18px] shrink-0';
        }

        var requestId = notification ? requestIdFromNotification(notification) : null;
        var customActions = notification && Array.isArray(notification._actions)
            ? notification._actions.filter(function (action) { return action && typeof action.run === 'function'; }).slice(0, 2)
            : [];
        var canAct = customActions.length > 0
            || !!(notification && notification.type === 'friend_request' && requestId && !notification._resolved && window.usertypoFriends);

        if (actions) {
            if (canAct) {
                actions.classList.remove('hidden');
                if (customActions.length) {
                    var firstAction = customActions[0];
                    var secondAction = customActions[1];
                    if (acceptBtn) {
                        acceptBtn.textContent = firstAction.label || 'Open';
                        acceptBtn.classList.toggle('hidden', !firstAction);
                        acceptBtn.disabled = false;
                        acceptBtn.onclick = async function () {
                            acceptBtn.disabled = true;
                            if (declineBtn) declineBtn.disabled = true;
                            try {
                                await firstAction.run(notification);
                                if (firstAction.resolve !== false) notification._resolved = true;
                                renderNotificationsPanel();
                            } catch (err) {
                                acceptBtn.disabled = false;
                                if (declineBtn) declineBtn.disabled = false;
                                showToast(err && err.message ? err.message : 'Action failed', 'error');
                            }
                        };
                    }
                    if (declineBtn) {
                        declineBtn.textContent = secondAction ? (secondAction.label || 'Dismiss') : '';
                        declineBtn.classList.toggle('hidden', !secondAction);
                        declineBtn.disabled = false;
                        declineBtn.onclick = secondAction ? async function () {
                            declineBtn.disabled = true;
                            if (acceptBtn) acceptBtn.disabled = true;
                            try {
                                await secondAction.run(notification);
                                if (secondAction.resolve !== false) notification._resolved = true;
                                renderNotificationsPanel();
                            } catch (err) {
                                declineBtn.disabled = false;
                                if (acceptBtn) acceptBtn.disabled = false;
                                showToast(err && err.message ? err.message : 'Action failed', 'error');
                            }
                        } : null;
                    }
                } else {
                    if (acceptBtn) {
                        acceptBtn.textContent = 'Accept';
                        acceptBtn.classList.remove('hidden');
                    }
                    if (declineBtn) {
                        declineBtn.textContent = 'Decline';
                        declineBtn.classList.remove('hidden');
                    }
                if (acceptBtn) {
                    acceptBtn.onclick = async function () {
                        acceptBtn.disabled = true;
                        if (declineBtn) declineBtn.disabled = true;
                        try {
                            await window.usertypoFriends.acceptRequest(requestId);
                            notification._resolved = true;
                            showToast('Friend request accepted', 'check_circle');
                            notifyFriendsChanged();
                            renderNotificationsPanel();
                        } catch (err) {
                            acceptBtn.disabled = false;
                            if (declineBtn) declineBtn.disabled = false;
                            showToast(window.usertypoFriends.mapRpcError(err).message, 'error');
                        }
                    };
                }
                if (declineBtn) {
                    declineBtn.onclick = async function () {
                        declineBtn.disabled = true;
                        if (acceptBtn) acceptBtn.disabled = true;
                        try {
                            await window.usertypoFriends.declineRequest(requestId);
                            notification._resolved = true;
                            showToast('Friend request declined', 'cancel');
                            notifyFriendsChanged();
                            renderNotificationsPanel();
                        } catch (err) {
                            declineBtn.disabled = false;
                            if (acceptBtn) acceptBtn.disabled = false;
                            showToast(window.usertypoFriends.mapRpcError(err).message, 'error');
                        }
                    };
                }
                if (acceptBtn) acceptBtn.disabled = false;
                if (declineBtn) declineBtn.disabled = false;
                }
            } else {
                actions.classList.add('hidden');
                if (acceptBtn) acceptBtn.onclick = null;
                if (declineBtn) declineBtn.onclick = null;
            }
        }

        toast.classList.add('visible');
        toast.style.opacity = '1';
        toast.style.pointerEvents = 'auto';

        if (toastHideTimer) nativeClearTimeout(toastHideTimer);
        toastHideTimer = nativeSetTimeout(hideToast, 5000);
    }

    function resolvePending(id) {
        if (id && pendingIndicatorId && id !== pendingIndicatorId) return false;
        var indicator = document.getElementById('dual-pending-indicator');
        if (pendingCollapseTimer) nativeClearTimeout(pendingCollapseTimer);
        pendingCollapseTimer = null;
        pendingIndicatorId = null;
        if (indicator) {
            indicator.classList.remove('visible', 'is-collapsed');
            indicator.setAttribute('aria-hidden', 'true');
        }
        return true;
    }

    function showPending(options) {
        options = options || {};
        var indicator = document.getElementById('dual-pending-indicator');
        var title = document.getElementById('dual-pending-title');
        var body = document.getElementById('dual-pending-body');
        var cancel = document.getElementById('dual-pending-cancel');
        if (!indicator || !title || !body || !cancel) return null;

        pendingIndicatorId = String(options.id || ('pending:' + Date.now()));
        title.textContent = options.title || 'Waiting for a dual';
        body.textContent = options.body || '';
        cancel.textContent = options.cancelLabel || 'Cancel';
        cancel.disabled = false;
        cancel.onclick = typeof options.onCancel === 'function' ? async function () {
            var idForCancel = pendingIndicatorId;
            cancel.disabled = true;
            try {
                await options.onCancel();
                resolvePending(idForCancel);
            } catch (error) {
                cancel.disabled = false;
                showToast(error && error.message ? error.message : 'Could not cancel', 'error');
            }
        } : null;
        cancel.classList.toggle('hidden', typeof options.onCancel !== 'function');

        indicator.classList.remove('is-collapsed');
        indicator.classList.add('visible');
        indicator.removeAttribute('aria-hidden');
        if (pendingCollapseTimer) nativeClearTimeout(pendingCollapseTimer);
        pendingCollapseTimer = nativeSetTimeout(function () {
            if (indicator.classList.contains('visible')) indicator.classList.add('is-collapsed');
        }, 5000);
        return pendingIndicatorId;
    }

    function requestIdFromNotification(n) {
        if (!n || !n.data) return null;
        var data = n.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return null; }
        }
        return data.request_id || null;
    }

    function isActionableFriendRequest(n) {
        if (!n || n.type !== 'friend_request') return false;
        return !!requestIdFromNotification(n);
    }

    function renderNotificationsPanel() {
        var friendsList = document.getElementById('notifications-friends-list');
        var friendsEmpty = document.getElementById('notifications-friends-empty');
        var whatsNewEmpty = document.getElementById('notifications-whatsnew-empty');
        var invalidEmpty = document.getElementById('notifications-invalid-empty');

        if (whatsNewEmpty) whatsNewEmpty.classList.remove('hidden');
        if (invalidEmpty) invalidEmpty.classList.remove('hidden');
        if (!friendsList) return;

        var friendNotes = cached.filter(function (n) {
            return n.type === 'friend_request'
                || n.type === 'friend_accepted'
                || String(n.type || '').indexOf('duel_') === 0;
        });

        friendsList.innerHTML = '';
        if (!friendNotes.length) {
            if (friendsEmpty) friendsEmpty.classList.remove('hidden');
            return;
        }
        if (friendsEmpty) friendsEmpty.classList.add('hidden');

        friendNotes.forEach(function (n) {
            var isUnread = !n.read_at;
            var requestId = requestIdFromNotification(n);
            var customActions = Array.isArray(n._actions)
                ? n._actions.filter(function (action) { return action && typeof action.run === 'function'; }).slice(0, 2)
                : [];
            var canAct = !n._resolved && (customActions.length > 0 || isActionableFriendRequest(n));
            var row = document.createElement('div');
            row.className = 'flex items-start gap-3 px-3 py-3 rounded-xl border transition-colors ' +
                (isUnread ? 'bg-primary/10 border-primary/25' : 'bg-white/[0.03] border-white/5');

            var actionsHtml = '';
            if (canAct) {
                var firstLabel = customActions.length ? (customActions[0].label || 'Open') : 'Accept';
                var secondLabel = customActions.length > 1 ? (customActions[1].label || 'Dismiss') : 'Decline';
                actionsHtml =
                    '<div class="flex items-center gap-2 mt-3">' +
                    '<button type="button" class="notif-accept-btn px-3 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-xs font-bold transition-colors">' + escapeHtml(firstLabel) + '</button>' +
                    (customActions.length === 1 ? '' : '<button type="button" class="notif-decline-btn px-3 py-1.5 rounded-lg bg-error/10 hover:bg-error/20 text-error border border-error/20 text-xs font-bold transition-colors">' + escapeHtml(secondLabel) + '</button>') +
                    '</div>';
            }

            row.innerHTML =
                '<span class="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">' +
                (n.type === 'friend_accepted' || n.type === 'duel_ready' ? 'check_circle' : (String(n.type).indexOf('duel_') === 0 ? 'swords' : 'person_add')) +
                '</span>' +
                '<div class="min-w-0 flex-1">' +
                '<div class="text-sm font-semibold text-slate-100">' + escapeHtml(n.title) + '</div>' +
                (n.body ? '<div class="text-xs text-slate-400 mt-1">' + escapeHtml(n.body) + '</div>' : '') +
                '<div class="text-[10px] text-slate-500 font-mono mt-2">' + relativeTime(n.created_at) + '</div>' +
                actionsHtml +
                '</div>' +
                (isUnread ? '<span class="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-2"></span>' : '');

            if (canAct && customActions.length) {
                var customAcceptBtn = row.querySelector('.notif-accept-btn');
                var customDeclineBtn = row.querySelector('.notif-decline-btn');
                var bindCustom = function (button, action) {
                    if (!button || !action) return;
                    button.addEventListener('click', async function (e) {
                        e.stopPropagation();
                        button.disabled = true;
                        try {
                            await action.run(n);
                            if (action.resolve !== false) n._resolved = true;
                            renderNotificationsPanel();
                        } catch (err) {
                            button.disabled = false;
                            showToast(err && err.message ? err.message : 'Action failed', 'error');
                        }
                    });
                };
                bindCustom(customAcceptBtn, customActions[0]);
                bindCustom(customDeclineBtn, customActions[1]);
            } else if (canAct && requestId && window.usertypoFriends) {
                var acceptBtn = row.querySelector('.notif-accept-btn');
                var declineBtn = row.querySelector('.notif-decline-btn');
                if (acceptBtn) {
                    acceptBtn.addEventListener('click', async function (e) {
                        e.stopPropagation();
                        acceptBtn.disabled = true;
                        if (declineBtn) declineBtn.disabled = true;
                        try {
                            await window.usertypoFriends.acceptRequest(requestId);
                            n._resolved = true;
                            n.body = 'Accepted';
                            showToast('Friend request accepted', 'check_circle');
                            notifyFriendsChanged();
                            renderNotificationsPanel();
                            if (typeof window.usertypoFriends.loadDashboard === 'function') {
                                /* friends page listens via event */
                            }
                        } catch (err) {
                            acceptBtn.disabled = false;
                            if (declineBtn) declineBtn.disabled = false;
                            showToast(window.usertypoFriends.mapRpcError(err).message, 'error');
                        }
                    });
                }
                if (declineBtn) {
                    declineBtn.addEventListener('click', async function (e) {
                        e.stopPropagation();
                        declineBtn.disabled = true;
                        if (acceptBtn) acceptBtn.disabled = true;
                        try {
                            await window.usertypoFriends.declineRequest(requestId);
                            n._resolved = true;
                            n.body = 'Declined';
                            showToast('Friend request declined', 'cancel');
                            notifyFriendsChanged();
                            renderNotificationsPanel();
                        } catch (err) {
                            declineBtn.disabled = false;
                            if (acceptBtn) acceptBtn.disabled = false;
                            showToast(window.usertypoFriends.mapRpcError(err).message, 'error');
                        }
                    });
                }
            }

            friendsList.appendChild(row);
        });
    }

    function ingestNotification(row, opts) {
        if (!row || !row.id) return;
        var isNew = !knownIds[row.id];
        knownIds[row.id] = true;

        var existingIdx = -1;
        for (var i = 0; i < cached.length; i++) {
            if (cached[i].id === row.id) {
                existingIdx = i;
                break;
            }
        }
        if (existingIdx >= 0) {
            var prevResolved = cached[existingIdx]._resolved;
            cached[existingIdx] = Object.assign({}, row, { _resolved: prevResolved });
        } else {
            cached.unshift(row);
        }

        unreadCount = cached.filter(function (n) { return !n.read_at; }).length;
        updateBadges();
        renderNotificationsPanel();

        if (isNew && opts && opts.toast && !row.read_at) {
            showToast(row);
            if (row.type === 'friend_request' || row.type === 'friend_accepted') {
                notifyFriendsChanged();
            }
        }
    }

    async function fetchNotifications() {
        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('get_my_notifications', { p_limit: 50 });
        if (result.error) throw result.error;
        return Array.isArray(result.data) ? result.data : [];
    }

    async function refresh(opts) {
        opts = opts || {};
        await requireAuth();
        var rows = await fetchNotifications();
        var ephemeralRows = cached.filter(function (n) { return n && n._ephemeral; });
        var resolvedMap = {};
        cached.forEach(function (n) {
            if (n && n.id && n._resolved) resolvedMap[n.id] = true;
        });

        if (opts.toastNew) {
            rows.forEach(function (row) {
                if (!row || !row.id) return;
                var wasKnown = !!knownIds[row.id];
                if (!wasKnown && !row.read_at) {
                    knownIds[row.id] = true;
                    showToast(Object.assign({}, row, { _resolved: !!resolvedMap[row.id] }));
                    if (row.type === 'friend_request' || row.type === 'friend_accepted') {
                        notifyFriendsChanged();
                    }
                }
            });
        }

        cached = ephemeralRows.concat(rows.map(function (n) {
            return Object.assign({}, n, { _resolved: !!(n && n.id && resolvedMap[n.id]) });
        }));
        knownIds = {};
        cached.forEach(function (n) { if (n && n.id) knownIds[n.id] = true; });
        unreadCount = cached.filter(function (n) { return !n.read_at; }).length;
        updateBadges();
        renderNotificationsPanel();

        return { notifications: cached, unreadCount: unreadCount };
    }

    function addEphemeral(notification, options) {
        var input = notification && typeof notification === 'object' ? notification : {};
        var row = Object.assign({}, input, {
            id: input.id || ('ephemeral:' + Date.now() + ':' + Math.random().toString(36).slice(2)),
            type: input.type || 'duel_notice',
            title: input.title || 'Notification',
            body: input.body || '',
            data: input.data || {},
            created_at: input.created_at || new Date().toISOString(),
            read_at: null,
            _ephemeral: true,
            _resolved: false,
        });
        var existing = cached.findIndex(function (item) { return item && item.id === row.id; });
        if (existing >= 0) cached.splice(existing, 1);
        cached.unshift(row);
        knownIds[row.id] = true;
        unreadCount = cached.filter(function (n) { return !n.read_at; }).length;
        updateBadges();
        renderNotificationsPanel();
        if (!options || options.toast !== false) showToast(row);
        return row;
    }

    async function markAllRead() {
        await requireAuth();
        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('mark_notifications_read');
        if (result.error) throw result.error;

        var nowIso = new Date().toISOString();
        cached = cached.map(function (n) {
            if (n.read_at) return n;
            return Object.assign({}, n, { read_at: nowIso });
        });
        unreadCount = 0;
        updateBadges();
        renderNotificationsPanel();
        return { ok: true };
    }

    async function subscribeRealtime(userId) {
        if (!userId || channel) return;
        try {
            var client = await window.usertypoDb.getClient();
            channel = client
                .channel('notifications:' + userId)
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: 'user_id=eq.' + userId,
                }, function (payload) {
                    if (payload && payload.new) ingestNotification(payload.new, { toast: true });
                })
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'notifications',
                    filter: 'user_id=eq.' + userId,
                }, function (payload) {
                    if (payload && payload.new) ingestNotification(payload.new, { toast: false });
                })
                .subscribe();
        } catch (err) {
            console.warn('[usertypo notifications] realtime subscribe failed', err);
            channel = null;
        }
    }

    function unsubscribeRealtime() {
        if (!channel || !window.usertypoDb) {
            channel = null;
            return;
        }
        window.usertypoDb.getClient().then(function (client) {
            try { client.removeChannel(channel); } catch (e) { /* ignore */ }
            channel = null;
        }).catch(function () { channel = null; });
    }

    function startPolling() {
        stopPolling();
        // Immediate check, then every POLL_MS (native timer — SPA pages wrap setInterval)
        refresh({ toastNew: true }).catch(function (err) {
            console.warn('[usertypo notifications] poll failed', err);
        });
        pollTimer = nativeSetInterval(function () {
            refresh({ toastNew: true }).catch(function (err) {
                console.warn('[usertypo notifications] poll failed', err);
            });
        }, POLL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            nativeClearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function start() {
        if (started) return;
        started = true;
        if (!window.usertypoAuth) return;
        await window.usertypoAuth.ready();

        window.usertypoAuth.onChange(function (state) {
            if (!state || !state.isSignedIn || !state.user) {
                cached = [];
                unreadCount = 0;
                knownIds = {};
                unsubscribeRealtime();
                stopPolling();
                updateBadges();
                renderNotificationsPanel();
                return;
            }
            refresh({ toastNew: false })
                .then(function () {
                    subscribeRealtime(state.user.id);
                    startPolling();
                })
                .catch(function (err) {
                    console.error('[usertypo notifications] start failed', err);
                });
        });

        var state = window.usertypoAuth.getState();
        if (state && state.isSignedIn && state.user) {
            try {
                await refresh({ toastNew: false });
                await subscribeRealtime(state.user.id);
                startPolling();
            } catch (err) {
                console.error('[usertypo notifications] initial load failed', err);
            }
        } else {
            updateBadges();
            renderNotificationsPanel();
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            var s = window.usertypoAuth && window.usertypoAuth.getState();
            if (s && s.isSignedIn && s.user) {
                refresh({ toastNew: true }).catch(function () { /* ignore */ });
            }
        });
    }

    function bindOpenClose() {
        var originalOpen = window.openNotifications;
        window.openNotifications = function () {
            if (typeof originalOpen === 'function') originalOpen();
            else {
                var modal = document.getElementById('notifications-modal');
                var box = document.getElementById('notifications-box');
                if (modal && box) {
                    modal.classList.remove('pointer-events-none');
                    box.classList.remove('scale-95', 'opacity-0');
                    box.classList.add('scale-100', 'opacity-100');
                }
            }
            refresh({ toastNew: false })
                .then(function () { return markAllRead(); })
                .catch(function (err) {
                    console.warn('[usertypo notifications] open/mark read failed', err);
                });
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            bindOpenClose();
            start();
        });
    } else {
        bindOpenClose();
        start();
    }

    window.usertypoNotifications = {
        start: start,
        refresh: refresh,
        markAllRead: markAllRead,
        getUnreadCount: function () { return unreadCount; },
        getCached: function () { return cached.slice(); },
        showToast: showToast,
        addEphemeral: addEphemeral,
        showPending: showPending,
        resolvePending: resolvePending,
    };
})();
