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
    var dismissedIds = {};
    var pollTimer = null;
    var pendingCollapseTimer = null;
    var pendingIndicatorId = null;
    var lastExpiryPurgeAt = 0;
    var POLL_MS = 2000;
    var TOAST_MS = 5000;
    var RETENTION_MS = 24 * 60 * 60 * 1000;

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

    function isRecent(notification) {
        var created = new Date(notification && notification.created_at).getTime();
        return !isFinite(created) || Date.now() - created < RETENTION_MS;
    }

    function removeToastElement(toast) {
        if (!toast || toast.dataset.removing === 'true') return;
        toast.dataset.removing = 'true';
        if (typeof toast._cancelDismiss === 'function') toast._cancelDismiss();
        toast.classList.remove('is-visible');
        nativeSetTimeout(function () {
            var stack = toast.parentNode;
            if (!stack) return;
            var before = Array.prototype.map.call(stack.children, function (item) {
                return { item: item, top: item.getBoundingClientRect().top };
            });
            toast.remove();
            before.forEach(function (entry) {
                if (!entry.item.isConnected || typeof entry.item.animate !== 'function') return;
                var delta = entry.top - entry.item.getBoundingClientRect().top;
                if (delta) entry.item.animate(
                    [{ transform: 'translateY(' + delta + 'px)' }, { transform: 'translateY(0)' }],
                    { duration: 280, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
                );
            });
        }, 350);
    }

    async function deleteNotification(notification, row) {
        if (!notification || !notification.id) return;
        if (row) row.classList.add('is-removing');
        dismissedIds[notification.id] = true;
        cached = cached.filter(function (item) { return item.id !== notification.id; });
        delete knownIds[notification.id];
        unreadCount = cached.filter(function (item) { return !item.read_at; }).length;
        updateBadges();
        if (!row) renderNotificationsPanel();
        else nativeSetTimeout(renderNotificationsPanel, 250);

        if (notification._ephemeral) return;
        try {
            var client = await window.usertypoDb.getClient();
            var result = await client.from('notifications').delete().eq('id', notification.id);
            if (result.error) throw result.error;
        } catch (error) {
            console.warn('[usertypo notifications] delete failed', error);
        }
    }

    function actionsFor(notification) {
        var custom = notification && Array.isArray(notification._actions)
            ? notification._actions.filter(function (action) { return action && typeof action.run === 'function'; }).slice(0, 2)
            : [];
        if (custom.length) return custom;
        var requestId = requestIdFromNotification(notification);
        if (!notification || notification.type !== 'friend_request' || !requestId || !window.usertypoFriends) return [];
        return [
            {
                label: 'Accept',
                run: function () {
                    return window.usertypoFriends.acceptRequest(requestId).then(function () {
                        notifyFriendsChanged();
                        showToast('Friend request accepted', 'check_circle');
                    });
                },
            },
            {
                label: 'Decline',
                run: function () {
                    return window.usertypoFriends.declineRequest(requestId).then(function () {
                        notifyFriendsChanged();
                        showToast('Friend request declined', 'cancel');
                    });
                },
            },
        ];
    }

    function bindAction(button, action, notification, toast, row) {
        if (!button || !action) return;
        button.addEventListener('click', async function (event) {
            event.stopPropagation();
            var scope = button.parentNode;
            Array.prototype.forEach.call(scope.querySelectorAll('button'), function (item) { item.disabled = true; });
            if (toast) removeToastElement(toast);
            var deletion = deleteNotification(notification, row);
            try {
                await action.run(notification);
                await deletion;
            } catch (error) {
                var message = error && error.message ? error.message : 'Action failed';
                if (window.usertypoFriends && typeof window.usertypoFriends.mapRpcError === 'function') {
                    try { message = window.usertypoFriends.mapRpcError(error).message; } catch (_) { /* ignore */ }
                }
                showToast(message, 'error');
            }
        });
    }

    /** Bottom-right alerts are independent, five-second, opacity-only toasts. */
    function showToast(notificationOrMessage, iconName) {
        var stack = document.getElementById('save-toast');
        if (!stack) return;
        var notification = (typeof notificationOrMessage === 'object' && notificationOrMessage) ? notificationOrMessage : null;
        var iconText = iconName || 'notifications';
        if (notification) {
            if (notification.type === 'friend_accepted') iconText = 'check_circle';
            else if (notification.type === 'friend_request') iconText = 'person_add';
            else if (String(notification.type || '').indexOf('duel_') === 0) iconText = 'swords';
        }

        var toast = document.createElement('div');
        toast.className = 'notification-toast glass-panel border border-primary/25 shadow-[0_0_20px_rgba(0,208,255,0.15)]';
        toast.style.backdropFilter = 'blur(20px)';
        var icon = document.createElement('span');
        icon.className = 'material-symbols-outlined ' +
            ((iconText === 'error' || iconText === 'cancel') ? 'text-error' : 'text-primary') +
            ' text-[18px] shrink-0';
        icon.textContent = iconText;
        var message = document.createElement('span');
        message.className = 'notification-toast-message text-sm font-semibold text-slate-100';
        message.textContent = notification ? (notification.title || 'Notification') : String(notificationOrMessage || 'Notification');
        toast.appendChild(icon);
        toast.appendChild(message);

        var actions = notification ? actionsFor(notification) : [];
        if (actions.length) {
            var actionWrap = document.createElement('div');
            actionWrap.className = 'notification-toast-actions';
            actions.forEach(function (action, index) {
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = action.label || (index ? 'Dismiss' : 'Open');
                button.className = index
                    ? 'px-2.5 py-1 rounded-full bg-error/10 hover:bg-error/20 text-error border border-error/20 text-[11px] font-bold transition-colors'
                    : 'px-2.5 py-1 rounded-full bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-[11px] font-bold transition-colors';
                actionWrap.appendChild(button);
                bindAction(button, action, notification, toast, null);
            });
            toast.appendChild(actionWrap);
        }

        stack.insertBefore(toast, stack.firstChild);
        requestAnimationFrame(function () { toast.classList.add('is-visible'); });
        var remaining = TOAST_MS;
        var startedAt = 0;
        var dismissTimer = null;
        function scheduleDismiss() {
            startedAt = Date.now();
            dismissTimer = nativeSetTimeout(function () { removeToastElement(toast); }, remaining);
        }
        function pauseDismiss() {
            if (!dismissTimer) return;
            nativeClearTimeout(dismissTimer);
            dismissTimer = null;
            remaining = Math.max(0, remaining - (Date.now() - startedAt));
        }
        toast._cancelDismiss = pauseDismiss;
        toast.addEventListener('mouseenter', pauseDismiss);
        toast.addEventListener('mouseleave', function () {
            if (toast.dataset.removing !== 'true') scheduleDismiss();
        });
        scheduleDismiss();
        return toast;
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

    function isFriendsOrMultiplayer(n) {
        var type = String(n && n.type || '');
        return type.indexOf('friend_') === 0
            || type.indexOf('duel_') === 0
            || type.indexOf('match_') === 0
            || type.indexOf('room_') === 0
            || type.indexOf('multiplayer_') === 0;
    }

    function notificationIcon(n) {
        var type = String(n && n.type || '');
        if (type === 'friend_accepted' || type === 'duel_ready') return 'check_circle';
        if (type === 'friend_request') return 'person_add';
        if (type.indexOf('duel_') === 0 || type.indexOf('match_') === 0) return 'swords';
        if (type.indexOf('invalid') !== -1) return 'error';
        return 'notifications';
    }

    function buildNotificationRow(n) {
        var isUnread = !n.read_at;
        var row = document.createElement('div');
        row.className = 'notification-row group flex items-center gap-3 px-3 py-3 rounded-xl border ' +
            (isUnread ? 'bg-primary/10 border-primary/25' : 'bg-white/[0.03] border-white/5');

        var icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-primary text-[20px] shrink-0';
        icon.textContent = notificationIcon(n);
        row.appendChild(icon);

        var content = document.createElement('div');
        content.className = 'min-w-0 flex-1';
        content.innerHTML =
            '<div class="text-sm font-semibold text-slate-100 break-words">' + escapeHtml(n.title) + '</div>' +
            (n.body ? '<div class="text-xs text-slate-400 mt-1 break-words">' + escapeHtml(n.body) + '</div>' : '') +
            '<div class="text-[10px] text-slate-500 font-mono mt-2">' + relativeTime(n.created_at) + '</div>';
        row.appendChild(content);

        var actions = actionsFor(n);
        if (actions.length) {
            var actionWrap = document.createElement('div');
            actionWrap.className = 'flex items-center gap-2 shrink-0 ml-auto';
            actions.forEach(function (action, index) {
                var button = document.createElement('button');
                button.type = 'button';
                button.textContent = action.label || (index ? 'Dismiss' : 'Open');
                button.className = index
                    ? 'px-3 py-1.5 rounded-lg bg-error/10 hover:bg-error/20 text-error border border-error/20 text-xs font-bold transition-colors'
                    : 'px-3 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-xs font-bold transition-colors';
                actionWrap.appendChild(button);
                bindAction(button, action, n, null, row);
            });
            row.appendChild(actionWrap);
        }

        if (isUnread) {
            var unread = document.createElement('span');
            unread.className = 'w-2 h-2 rounded-full bg-red-500 shrink-0';
            row.appendChild(unread);
        }

        var deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'notification-delete material-symbols-outlined text-slate-500 hover:text-error shrink-0';
        deleteButton.textContent = 'delete';
        deleteButton.title = 'Delete notification';
        deleteButton.setAttribute('aria-label', 'Delete notification');
        deleteButton.addEventListener('click', function (event) {
            event.stopPropagation();
            deleteNotification(n, row);
        });
        row.appendChild(deleteButton);
        return row;
    }

    function renderNotificationsPanel() {
        var friendsList = document.getElementById('notifications-friends-list');
        var friendsEmpty = document.getElementById('notifications-friends-empty');
        var generalList = document.getElementById('notifications-general-list');
        var generalEmpty = document.getElementById('notifications-general-empty');
        if (!friendsList || !generalList) return;

        cached = cached.filter(isRecent);
        var friendNotes = cached.filter(isFriendsOrMultiplayer);
        var generalNotes = cached.filter(function (n) { return !isFriendsOrMultiplayer(n); });
        friendsList.innerHTML = '';
        generalList.innerHTML = '';
        friendNotes.forEach(function (n) { friendsList.appendChild(buildNotificationRow(n)); });
        generalNotes.forEach(function (n) { generalList.appendChild(buildNotificationRow(n)); });
        if (friendsEmpty) friendsEmpty.classList.toggle('hidden', friendNotes.length > 0);
        if (generalEmpty) generalEmpty.classList.toggle('hidden', generalNotes.length > 0);
    }

    function ingestNotification(row, opts) {
        if (!row || !row.id || dismissedIds[row.id] || !isRecent(row)) return;
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
        if (Date.now() - lastExpiryPurgeAt > 60 * 60 * 1000) {
            lastExpiryPurgeAt = Date.now();
            var cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
            var purge = await client.from('notifications').delete().lt('created_at', cutoff);
            if (purge.error) console.warn('[usertypo notifications] expiry cleanup failed', purge.error);
        }
        var result = await client.rpc('get_my_notifications', { p_limit: 50 });
        if (result.error) throw result.error;
        return Array.isArray(result.data) ? result.data : [];
    }

    async function refresh(opts) {
        opts = opts || {};
        await requireAuth();
        var rows = (await fetchNotifications()).filter(function (n) {
            return n && !dismissedIds[n.id] && isRecent(n);
        });
        var ephemeralRows = cached.filter(function (n) {
            return n && n._ephemeral && !dismissedIds[n.id] && isRecent(n);
        });
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
                dismissedIds = {};
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

        var modal = document.getElementById('notifications-modal');
        if (modal && modal.dataset.outsideCloseBound !== 'true') {
            modal.dataset.outsideCloseBound = 'true';
            modal.addEventListener('click', function (event) {
                if (event.target === modal && typeof window.closeNotifications === 'function') {
                    window.closeNotifications();
                }
            });
        }
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
