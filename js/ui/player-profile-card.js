/**
 * Mid-page player profile box (userstats hero layout, menu-bubble glass).
 * Opens on .player-level-avatar[data-user-id] click. No page dim/blur.
 * Public API: window.usertypoPlayerProfileCard
 */
(function () {
    var openUserId = null;
    var sending = false;
    var blocking = false;

    function $(id) {
        return document.getElementById(id);
    }

    function formatAccuracy(value) {
        if (window.usertypoSessions && window.usertypoSessions.formatAccuracy) {
            return window.usertypoSessions.formatAccuracy(value);
        }
        if (value == null || !isFinite(Number(value))) return '—';
        var n = Number(value);
        return (n % 1 === 0 ? String(n) : n.toFixed(1)) + '%';
    }

    function formatCompact(value) {
        if (window.usertypoSessions && window.usertypoSessions.formatCompactNumber) {
            return window.usertypoSessions.formatCompactNumber(value);
        }
        return String(value || 0);
    }

    function formatDuration(seconds) {
        if (window.usertypoSessions && window.usertypoSessions.formatDurationShort) {
            return window.usertypoSessions.formatDurationShort(seconds);
        }
        return String(seconds || 0) + 's';
    }

    function ensureDom() {
        return !!($('player-profile-overlay') && $('player-profile-box'));
    }

    function setOpen(isOpen) {
        var overlay = $('player-profile-overlay');
        var box = $('player-profile-box');
        if (!overlay || !box) return;
        if (isOpen) {
            overlay.classList.remove('pointer-events-none', 'opacity-0');
            overlay.classList.add('pointer-events-auto', 'opacity-100');
            box.classList.remove('scale-95', 'opacity-0');
            box.classList.add('scale-100', 'opacity-100');
            overlay.setAttribute('aria-hidden', 'false');
        } else {
            overlay.classList.add('pointer-events-none', 'opacity-0');
            overlay.classList.remove('pointer-events-auto', 'opacity-100');
            box.classList.add('scale-95', 'opacity-0');
            box.classList.remove('scale-100', 'opacity-100');
            overlay.setAttribute('aria-hidden', 'true');
            openUserId = null;
            sending = false;
            blocking = false;
        }
    }

    function fillBest(mode, amount, best) {
        var card = document.querySelector(
            '#player-profile-box [data-ppc-best="' + mode + ':' + amount + '"]'
        );
        if (!card) return;
        var wpmEl = card.querySelector('[data-ppc-wpm]');
        var accEl = card.querySelector('[data-ppc-acc]');
        if (!best) {
            if (wpmEl) wpmEl.textContent = '—';
            if (accEl) accEl.textContent = '—';
            return;
        }
        if (wpmEl) wpmEl.textContent = String(Math.round(best.wpm));
        if (accEl) accEl.textContent = formatAccuracy(best.accuracy);
    }

    function setFriendSlot(card) {
        var slot = $('ppc-friend-slot');
        if (!slot) return;
        slot.innerHTML = '';
        if (!card || card.isSelf || card.relationship === 'self') return;
        // Friends: no friend request and no block (must unfriend first).
        if (card.relationship === 'friends') return;

        var wrap = document.createElement('div');
        wrap.className = 'mt-5 w-full flex flex-col sm:flex-row items-center justify-center gap-2';

        if (card.iBlocked) {
            var unblockBtn = document.createElement('button');
            unblockBtn.type = 'button';
            unblockBtn.id = 'ppc-unblock-btn';
            unblockBtn.className =
                'w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl ' +
                'bg-surface/60 hover:bg-surface text-slate-300 border border-white/10 ' +
                'text-sm font-bold transition-colors';
            unblockBtn.innerHTML =
                '<span class="material-symbols-outlined text-[18px]">lock_open</span>' +
                '<span>Unblock</span>';
            unblockBtn.addEventListener('click', function () {
                unblockPlayer(card.userId, unblockBtn);
            });
            wrap.appendChild(unblockBtn);
            slot.appendChild(wrap);
            return;
        }

        if (card.relationship === 'pending_received') {
            var note = document.createElement('p');
            note.className = 'text-xs text-slate-500 font-bold text-center w-full sm:w-auto';
            note.textContent = 'Friend request received — check Friends';
            wrap.appendChild(note);
        } else if (card.relationship !== 'pending_sent') {
            var friendBtn = document.createElement('button');
            friendBtn.type = 'button';
            friendBtn.id = 'ppc-friend-btn';
            friendBtn.className =
                'w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl ' +
                'bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 ' +
                'text-sm font-bold transition-colors';
            friendBtn.innerHTML =
                '<span class="material-symbols-outlined text-[18px]">person_add</span>' +
                '<span>Send Friend Request</span>';
            friendBtn.addEventListener('click', function () {
                sendFriendRequest(card.userId, friendBtn);
            });
            wrap.appendChild(friendBtn);
        }

        var blockBtn = document.createElement('button');
        blockBtn.type = 'button';
        blockBtn.id = 'ppc-block-btn';
        blockBtn.className =
            'w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl ' +
            'bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-400/20 ' +
            'text-sm font-bold transition-colors';
        blockBtn.innerHTML =
            '<span class="material-symbols-outlined text-[18px]">block</span>' +
            '<span>Block</span>';
        blockBtn.addEventListener('click', function () {
            blockPlayer(card.userId, blockBtn);
        });
        wrap.appendChild(blockBtn);
        slot.appendChild(wrap);
    }

    async function sendFriendRequest(userId, btn) {
        if (sending || blocking || !userId || !window.usertypoFriends) return;
        sending = true;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-60', 'cursor-not-allowed');
            btn.querySelector('span:last-child').textContent = 'Sending…';
        }
        try {
            await window.usertypoFriends.sendRequest(userId);
            if (window.usertypoPublicProfile) window.usertypoPublicProfile.invalidate(userId);
            if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast('Friend request sent.', 'person_add');
            }
            var card = await window.usertypoPublicProfile.getCard(userId, { force: true });
            if (card && !card.error) setFriendSlot(card);
            else {
                var slot = $('ppc-friend-slot');
                if (slot) slot.innerHTML = '';
            }
        } catch (err) {
            var mapped = window.usertypoFriends.mapRpcError
                ? window.usertypoFriends.mapRpcError(err)
                : { message: (err && err.message) || 'Could not send request' };
            if (mapped.code === 'already_friends' || mapped.code === 'request_already_sent') {
                if (window.usertypoPublicProfile) window.usertypoPublicProfile.invalidate(userId);
                var refreshed = await window.usertypoPublicProfile.getCard(userId, { force: true }).catch(function () { return null; });
                if (refreshed && !refreshed.error) setFriendSlot(refreshed);
                else {
                    var slot = $('ppc-friend-slot');
                    if (slot) slot.innerHTML = '';
                }
            } else if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast(mapped.message, 'error');
            }
            if (btn && mapped.code !== 'already_friends' && mapped.code !== 'request_already_sent') {
                btn.disabled = false;
                btn.classList.remove('opacity-60', 'cursor-not-allowed');
                btn.querySelector('span:last-child').textContent = 'Send Friend Request';
            }
        } finally {
            sending = false;
        }
    }

    async function blockPlayer(userId, btn) {
        if (blocking || sending || !userId || !window.usertypoFriends) return;
        blocking = true;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-60', 'cursor-not-allowed');
            btn.querySelector('span:last-child').textContent = 'Blocking…';
        }
        try {
            await window.usertypoFriends.blockUser(userId);
            if (window.usertypoPublicProfile) window.usertypoPublicProfile.invalidate(userId);
            if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast('Player blocked.', 'block');
            }
            var card = await window.usertypoPublicProfile.getCard(userId, { force: true });
            if (card && !card.error) setFriendSlot(card);
        } catch (err) {
            var mapped = window.usertypoFriends.mapRpcError
                ? window.usertypoFriends.mapRpcError(err)
                : { message: (err && err.message) || 'Could not block player' };
            if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast(mapped.message, 'error');
            }
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60', 'cursor-not-allowed');
                btn.querySelector('span:last-child').textContent = 'Block';
            }
        } finally {
            blocking = false;
        }
    }

    async function unblockPlayer(userId, btn) {
        if (blocking || sending || !userId || !window.usertypoFriends) return;
        blocking = true;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-60', 'cursor-not-allowed');
            btn.querySelector('span:last-child').textContent = 'Unblocking…';
        }
        try {
            await window.usertypoFriends.unblockUser(userId);
            if (window.usertypoPublicProfile) window.usertypoPublicProfile.invalidate(userId);
            if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast('Player unblocked.', 'lock_open');
            }
            var card = await window.usertypoPublicProfile.getCard(userId, { force: true });
            if (card && !card.error) setFriendSlot(card);
        } catch (err) {
            var mapped = window.usertypoFriends.mapRpcError
                ? window.usertypoFriends.mapRpcError(err)
                : { message: (err && err.message) || 'Could not unblock player' };
            if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
                window.usertypoNotifications.showToast(mapped.message, 'error');
            }
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60', 'cursor-not-allowed');
                btn.querySelector('span:last-child').textContent = 'Unblock';
            }
        } finally {
            blocking = false;
        }
    }

    function fillCard(card) {
        var nameEl = $('ppc-username');
        var publicIdEl = $('ppc-public-id');
        var titleEl = $('ppc-level-title');
        var xpEl = $('ppc-xp-progress');
        var streakEl = $('ppc-streak');
        var avatarHost = $('ppc-avatar-host');
        var testsEl = $('ppc-stat-tests');
        var timeEl = $('ppc-stat-time');
        var wordsEl = $('ppc-stat-words');
        var rankEl = $('ppc-stat-rank');
        var statusEl = $('ppc-status');

        if (statusEl) statusEl.textContent = '';
        if (nameEl) nameEl.textContent = card.username || 'Player';
        if (publicIdEl) {
            publicIdEl.textContent = card.publicId
                ? String(card.publicId).toUpperCase()
                : '—';
        }
        if (titleEl) titleEl.textContent = card.title || 'Novice';
        if (xpEl) xpEl.textContent = (card.xpIntoLevel || 0) + ' / ' + (card.xpToNext || 100) + ' XP';
        if (streakEl) streakEl.textContent = String(card.currentStreak || 0);

        if (avatarHost && window.usertypoPlayerAvatar) {
            avatarHost.innerHTML = window.usertypoPlayerAvatar.render({
                avatarUrl: card.avatarUrl,
                name: card.username,
                level: card.level,
                percentToNext: card.percentToNext,
                size: 'host',
                userId: null, // don't nest open-on-click
                className: 'ppc-hero-avatar',
            });
        }

        if (testsEl) testsEl.textContent = formatCompact(card.summary && card.summary.tests);
        if (timeEl) timeEl.textContent = formatDuration(card.summary && card.summary.totalSeconds);
        if (wordsEl) wordsEl.textContent = formatCompact(card.summary && card.summary.totalWords);
        if (rankEl) rankEl.textContent = '—';

        fillBest('time', 15, card.bests['time:15']);
        fillBest('time', 30, card.bests['time:30']);
        fillBest('time', 60, card.bests['time:60']);
        fillBest('time', 120, card.bests['time:120']);
        fillBest('words', 10, card.bests['words:10']);
        fillBest('words', 25, card.bests['words:25']);
        fillBest('words', 50, card.bests['words:50']);
        fillBest('words', 100, card.bests['words:100']);

        setFriendSlot(card);
    }

    function showLoading() {
        var statusEl = $('ppc-status');
        if (statusEl) statusEl.textContent = 'Loading…';
        var nameEl = $('ppc-username');
        if (nameEl) nameEl.textContent = 'Loading…';
        var publicIdEl = $('ppc-public-id');
        if (publicIdEl) publicIdEl.textContent = '—';
        var slot = $('ppc-friend-slot');
        if (slot) slot.innerHTML = '';
    }

    function showError(message) {
        var statusEl = $('ppc-status');
        if (statusEl) statusEl.textContent = message || 'Could not load profile.';
    }

    function notifyProfileDenied() {
        var message = 'You are not allowed to see this players profile.';
        if (window.usertypoNotifications && typeof window.usertypoNotifications.showToast === 'function') {
            window.usertypoNotifications.showToast(message, 'lock');
            return;
        }
        try {
            window.alert(message);
        } catch (e) { /* ignore */ }
    }

    function notifyBlockedByUser() {
        var message = 'This player has blocked you.';
        if (window.usertypoNotifications && typeof window.usertypoNotifications.showToast === 'function') {
            window.usertypoNotifications.showToast(message, 'block');
            return;
        }
        try {
            window.alert(message);
        } catch (e) { /* ignore */ }
    }

    async function open(userId) {
        if (!ensureDom()) return;
        var id = String(userId || '').trim();
        if (!id || id.indexOf('guest_') === 0) return;

        if (!window.usertypoPublicProfile) {
            openUserId = id;
            showLoading();
            setOpen(true);
            showError('Profile unavailable.');
            return;
        }

        try {
            var card = await window.usertypoPublicProfile.getCard(id, { force: true });
            if (!card || card.error) {
                if (card && card.error === 'blocked_by_user') {
                    notifyBlockedByUser();
                    return;
                }
                if (card && card.error === 'profile_not_allowed') {
                    notifyProfileDenied();
                    return;
                }
                openUserId = id;
                showLoading();
                setOpen(true);
                var msg = {
                    guest: 'Sign in to view profiles.',
                    not_authenticated: 'Sign in to view profiles.',
                    user_not_found: 'Player not found.',
                    invalid_user: 'Player not found.',
                }[card && card.error] || 'Could not load profile.';
                showError(msg);
                return;
            }
            openUserId = id;
            showLoading();
            setOpen(true);
            fillCard(card);
        } catch (err) {
            console.warn('[usertypo profile card]', err);
            openUserId = id;
            showLoading();
            setOpen(true);
            showError('Could not load profile.');
        }
    }

    function close() {
        setOpen(false);
    }

    function onDocumentClick(event) {
        var avatar = event.target && event.target.closest
            ? event.target.closest('.player-level-avatar[data-user-id]')
            : null;
        if (avatar) {
            var uid = avatar.getAttribute('data-user-id');
            if (!uid) return;
            // Own shell / dual bubble avatars keep their parent navigation.
            if (avatar.id === 'shell-user-avatar' || avatar.id === 'dual-stats-user-avatar') return;
            event.preventDefault();
            event.stopPropagation();
            open(uid);
            return;
        }

        var overlay = $('player-profile-overlay');
        var box = $('player-profile-box');
        if (!overlay || overlay.classList.contains('pointer-events-none')) return;
        if (box && box.contains(event.target)) return;
        if (overlay.contains(event.target)) close();
    }

    function onKeyDown(event) {
        if (event.key === 'Escape' && openUserId) close();
    }

    function boot() {
        if (!ensureDom()) return;
        document.addEventListener('click', onDocumentClick, true);
        document.addEventListener('keydown', onKeyDown);
        var closeBtn = $('ppc-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', close);
    }

    window.usertypoPlayerProfileCard = {
        open: open,
        close: close,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
