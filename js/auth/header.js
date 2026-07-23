/**
 * Shell header ↔ auth state binding.
 * Account bubble: avatar + XP ring + level badge + transient +XP toast.
 */
(function () {
    var XP_RING_CIRCUMFERENCE = 2 * Math.PI * 18; // r=18 in 40x40 viewBox
    var xpToastTimer = null;

    function displayName(user, profile) {
        if (profile && profile.username) return profile.username;
        if (profile && profile.display_name) return profile.display_name;
        if (!user) return 'Guest';
        if (user.username) return user.username;
        if (user.fullName) return user.fullName;
        if (user.firstName) return user.firstName;
        var email = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
        if (email) return email.split('@')[0];
        return 'Player';
    }

    function initialFor(name) {
        var clean = String(name || '?').trim();
        return (clean.charAt(0) || '?').toUpperCase();
    }

    function avatarUrl(user, profile) {
        if (profile && profile.avatar_url) return profile.avatar_url;
        if (user && user.imageUrl) return user.imageUrl;
        return null;
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setXpRingPercent(percent) {
        var ring = document.getElementById('header-account-xp-ring');
        if (!ring) return;
        var pct = Math.min(100, Math.max(0, Number(percent) || 0));
        var offset = XP_RING_CIRCUMFERENCE * (1 - pct / 100);
        ring.style.strokeDasharray = String(XP_RING_CIRCUMFERENCE);
        ring.style.strokeDashoffset = String(offset);
    }

    function setAccountAvatar(url, name) {
        var img = document.getElementById('header-account-avatar');
        var icon = document.getElementById('header-account-icon');
        if (img) {
            if (url) {
                img.src = url;
                img.alt = (name || 'Profile') + ' avatar';
                img.classList.remove('hidden');
                if (icon) icon.classList.add('hidden');
            } else {
                img.removeAttribute('src');
                img.classList.add('hidden');
                if (icon) icon.classList.remove('hidden');
            }
        } else if (icon) {
            icon.classList.remove('hidden');
        }
    }

    function setAccountLevel(level, visible) {
        var badge = document.getElementById('header-account-level');
        var ringTrack = document.getElementById('header-account-xp-track');
        var ringFg = document.getElementById('header-account-xp-ring');
        if (badge) {
            if (visible) {
                badge.textContent = String(Math.max(1, Math.floor(Number(level) || 1)));
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
        if (ringTrack) ringTrack.classList.toggle('opacity-0', !visible);
        if (ringFg) ringFg.classList.toggle('opacity-0', !visible);
    }

    function showXpGain(amount, award) {
        var toast = document.getElementById('header-xp-toast');
        var xp = Math.max(0, Math.floor(Number(amount) || 0));
        if (!toast || xp <= 0) return;

        toast.textContent = '+' + xp;
        toast.classList.remove('hidden', 'opacity-0', 'translate-y-1');
        toast.classList.add('opacity-100');

        if (award && award.percentToNext != null) {
            setXpRingPercent(award.percentToNext);
        }
        if (award && award.newLevel != null) {
            setAccountLevel(award.newLevel, true);
        }

        if (xpToastTimer) clearTimeout(xpToastTimer);
        xpToastTimer = setTimeout(function () {
            toast.classList.add('opacity-0', 'translate-y-1');
            setTimeout(function () {
                toast.classList.add('hidden');
            }, 300);
            xpToastTimer = null;
        }, 5000);
    }

    function updateHeader(state) {
        var isSignedIn = !!(state && state.isSignedIn && state.user);
        var profile = window.__USERTYPO_PROFILE__ || null;
        var progression = (window.usertypoProgression && window.usertypoProgression.getCached)
            ? window.usertypoProgression.getCached()
            : (window.__USERTYPO_PROGRESSION__ || null);
        var name = isSignedIn ? displayName(state.user, profile) : 'Guest';
        var photo = isSignedIn ? avatarUrl(state.user, profile) : null;
        var tier = 'Not signed in';
        if (isSignedIn) {
            if (progression && progression.level) {
                var title = progression.title || '';
                tier = 'LVL ' + progression.level + (title ? ' · ' + title : '');
            } else {
                tier = 'Signed in';
            }
        }

        setText('shell-user-name', name);
        setText('shell-user-tier', tier);

        var shellAvatar = document.getElementById('shell-user-avatar');
        if (shellAvatar && window.usertypoPlayerAvatar) {
            if (isSignedIn) {
                shellAvatar.outerHTML = window.usertypoPlayerAvatar.render({
                    id: 'shell-user-avatar',
                    avatarUrl: photo,
                    name: name,
                    level: progression && progression.level || 1,
                    percentToNext: progression && progression.percentToNext || 0,
                    size: 'sm',
                    showLevel: true,
                    className: 'shrink-0',
                });
            } else {
                shellAvatar.outerHTML = window.usertypoPlayerAvatar.render({
                    id: 'shell-user-avatar',
                    name: 'Guest',
                    size: 'sm',
                    showLevel: false,
                    className: 'shrink-0',
                    initial: '?',
                });
            }
        } else {
            setText('shell-user-avatar', initialFor(name));
        }

        var authAction = document.getElementById('shell-auth-action');
        var authIcon = document.getElementById('shell-auth-action-icon');
        var accountBtn = document.getElementById('header-account-btn');
        var accountIcon = document.getElementById('header-account-icon');
        var userStatsLink = document.getElementById('nav-userstats');

        if (isSignedIn) {
            if (authAction) {
                authAction.setAttribute('href', '#');
                authAction.removeAttribute('data-spa-link');
                authAction.title = 'Sign out';
                authAction.setAttribute('aria-label', 'Sign out');
                authAction.onclick = function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!window.usertypoAuth) return;
                    window.usertypoAuth.signOut().then(function () {
                        window.__USERTYPO_PROFILE__ = null;
                        if (window.usertypoProgression && typeof window.usertypoProgression.clearCache === 'function') {
                            window.usertypoProgression.clearCache();
                        }
                        if (window.navigateTo) window.navigateTo('/signin');
                        else window.location.href = '/signin';
                    }).catch(function (err) {
                        console.error('[usertypo auth] sign out failed', err);
                    });
                };
            }
            if (authIcon) authIcon.textContent = 'logout';
            if (accountBtn) {
                accountBtn.setAttribute('href', '/userstats');
                accountBtn.title = name;
                accountBtn.setAttribute('aria-label', 'Your profile');
            }
            if (accountIcon) accountIcon.textContent = 'person';
            setAccountAvatar(photo, name);
            if (progression) {
                setAccountLevel(progression.level, true);
                setXpRingPercent(progression.percentToNext || 0);
            } else {
                setAccountLevel(1, true);
                setXpRingPercent(0);
            }
            if (userStatsLink) userStatsLink.setAttribute('href', '/userstats');
        } else {
            if (authAction) {
                authAction.setAttribute('href', '/signin');
                authAction.setAttribute('data-spa-link', '');
                authAction.title = 'Sign in';
                authAction.setAttribute('aria-label', 'Sign in');
                authAction.onclick = null;
            }
            if (authIcon) authIcon.textContent = 'login';
            if (accountBtn) {
                accountBtn.setAttribute('href', '/signin');
                accountBtn.title = 'Sign in';
                accountBtn.setAttribute('aria-label', 'Sign in');
            }
            if (accountIcon) accountIcon.textContent = 'login';
            setAccountAvatar(null, null);
            setAccountLevel(1, false);
            setXpRingPercent(0);
            if (userStatsLink) userStatsLink.setAttribute('href', '/signin');
        }
    }

    function boot() {
        if (!window.usertypoAuth) {
            updateHeader({ isSignedIn: false, user: null });
            return;
        }
        window.usertypoAuth.onChange(function (state) {
            updateHeader(state);
        });

        window.addEventListener('usertypo:profile-synced', function () {
            try { updateHeader(window.usertypoAuth.getState()); } catch (e) { /* ignore */ }
        });

        window.addEventListener('usertypo:progression-updated', function (ev) {
            try {
                updateHeader(window.usertypoAuth.getState());
                var award = ev && ev.detail && ev.detail.award;
                if (award && !award.skipped && award.xpGained > 0) {
                    showXpGain(award.xpGained, award);
                }
            } catch (e) { /* ignore */ }
        });

        window.usertypoAuth.ready().then(function () {
            updateHeader(window.usertypoAuth.getState());
            if (
                window.usertypoAuth.getState().isSignedIn &&
                window.usertypoProgression &&
                typeof window.usertypoProgression.getMine === 'function'
            ) {
                window.usertypoProgression.getMine({ force: true }).catch(function () { /* ignore */ });
            }
        }).catch(function () {
            updateHeader({ isSignedIn: false, user: null });
        });
    }

    window.usertypoHeader = {
        showXpGain: showXpGain,
        setXpRingPercent: setXpRingPercent,
        updateHeader: function () {
            if (!window.usertypoAuth) return;
            try { updateHeader(window.usertypoAuth.getState()); } catch (e) { /* ignore */ }
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
