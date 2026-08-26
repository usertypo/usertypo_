/**
 * Shell header ↔ auth state binding.
 * Account bubble: shared player-level-avatar (photo + XP ring + level) + transient +XP toast.
 *
 * Important: do NOT remount the avatar DOM on every XP tick — replacing <img> makes the
 * photo disappear until it reloads (noticeable after finishing a test).
 */
(function () {
    var xpToastTimer = null;
    var lastAccountOpts = null;

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
        // Only use Clerk URL when the user actually uploaded / OAuth-provided a real image.
        if (user && user.hasImage === true && user.imageUrl) return user.imageUrl;
        return null;
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function sameAvatarSrc(a, b) {
        return String(a || '') === String(b || '');
    }

    function applyEagerHeaderImg(root) {
        if (!root) return;
        var img = root.querySelector('img.player-level-avatar__img, img');
        if (!img) return;
        img.loading = 'eager';
        img.removeAttribute('loading');
        img.decoding = 'async';
        img.fetchPriority = 'high';
    }

    function updateAccountInPlace(root, opts) {
        var pla = root.querySelector('.player-level-avatar');
        if (!pla) return false;

        var showLevel = !!opts.showLevel;
        var level = Math.max(1, Math.floor(Number(opts.level) || 1));
        var pct = Number(opts.percentToNext) || 0;

        if (window.usertypoPlayerAvatar && typeof window.usertypoPlayerAvatar.ringOffset === 'function') {
            var offset = window.usertypoPlayerAvatar.ringOffset(showLevel ? pct : 0);
            var progress = pla.querySelector('.player-level-avatar__progress');
            var track = pla.querySelector('.player-level-avatar__track');
            if (progress) {
                progress.style.strokeDashoffset = String(offset);
                progress.classList.toggle('opacity-0', !showLevel);
            }
            if (track) track.classList.toggle('opacity-0', !showLevel);
        }

        var levelEl = pla.querySelector('.player-level-avatar__level');
        if (showLevel) {
            if (levelEl) {
                levelEl.textContent = String(level);
            } else {
                return false; // need remount to add badge
            }
        } else if (levelEl) {
            levelEl.remove();
        }

        pla.setAttribute('data-level', String(level));
        pla.setAttribute('data-xp-percent', String(pct));
        if (opts.name) {
            pla.setAttribute('title', opts.name);
            pla.setAttribute('aria-label', opts.name + (showLevel ? (', level ' + level) : ''));
        }

        var img = pla.querySelector('img.player-level-avatar__img');
        var nextSrc = opts.avatarUrl || '';
        if (img && nextSrc && img.getAttribute('src') !== nextSrc) {
            img.src = nextSrc;
            img.alt = (opts.name || 'Profile') + ' avatar';
            applyEagerHeaderImg(pla);
        } else if (img && !nextSrc) {
            // Switching to default — remount so default SVG renders cleanly
            return false;
        } else if (!img && nextSrc) {
            return false; // need remount to add photo
        }

        return true;
    }

    function mountAccountAvatar(opts) {
        var mount = document.getElementById('header-account-btn');
        if (!mount) return;

        var merged = Object.assign({}, lastAccountOpts || {
            avatarUrl: '',
            name: 'Guest',
            level: 1,
            percentToNext: 0,
            showLevel: false,
        }, opts || {});

        var prev = lastAccountOpts;
        lastAccountOpts = merged;

        var existing = mount.querySelector('.player-level-avatar');
        var canInPlace = !!(existing && prev
            && sameAvatarSrc(prev.avatarUrl, merged.avatarUrl)
            && !!prev.showLevel === !!merged.showLevel
            && (merged.avatarUrl || !prev.avatarUrl) // both empty or both set
        );

        // Prefer in-place ring/level updates when the photo identity is unchanged
        if (canInPlace && updateAccountInPlace(mount, merged)) {
            return;
        }

        if (window.usertypoPlayerAvatar && typeof window.usertypoPlayerAvatar.render === 'function') {
            mount.innerHTML = window.usertypoPlayerAvatar.render({
                id: 'header-account-pla',
                avatarUrl: merged.avatarUrl || '',
                name: merged.name || 'Guest',
                level: merged.level || 1,
                percentToNext: merged.percentToNext || 0,
                size: 'md',
                showLevel: !!merged.showLevel,
                clickable: false,
                className: 'header-account-pla',
            });
            applyEagerHeaderImg(mount);
            return;
        }

        // Fallback before player-avatar.js loads
        var src = merged.avatarUrl || '';
        mount.innerHTML =
            '<span class="header-account-fallback" aria-hidden="true">' +
            (src
                ? '<img src="' + String(src).replace(/"/g, '&quot;') + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;display:block;" />'
                : '<span class="material-symbols-outlined" style="font-size:1rem;color:var(--theme-primary,#fff);">person</span>') +
            '</span>';
    }

    function setXpRingPercent(percent) {
        if (!lastAccountOpts) return;
        mountAccountAvatar({ percentToNext: percent });
    }

    function setAccountLevel(level, visible) {
        if (!lastAccountOpts) return;
        mountAccountAvatar({
            level: level,
            showLevel: !!visible,
        });
    }

    function showXpGain(amount, award) {
        var toast = document.getElementById('header-xp-toast');
        var xp = Math.max(0, Math.floor(Number(amount) || 0));
        if (!toast || xp <= 0) return;

        toast.textContent = '+' + xp;
        toast.classList.remove('hidden', 'opacity-0', 'translate-y-1');
        toast.classList.add('opacity-100');

        var patch = {};
        if (award && award.percentToNext != null) patch.percentToNext = award.percentToNext;
        if (award && award.newLevel != null) {
            patch.level = award.newLevel;
            patch.showLevel = true;
        }
        if (Object.keys(patch).length) mountAccountAvatar(patch);

        if (xpToastTimer) clearTimeout(xpToastTimer);
        xpToastTimer = setTimeout(function () {
            toast.classList.remove('opacity-100');
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
            // Keep last known photo if this update somehow has no URL (avoids blank flash mid-sync)
            var nextPhoto = photo || (lastAccountOpts && lastAccountOpts.avatarUrl) || '';
            mountAccountAvatar({
                avatarUrl: nextPhoto,
                name: name,
                level: progression && progression.level || 1,
                percentToNext: progression && progression.percentToNext || 0,
                showLevel: true,
            });
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
            mountAccountAvatar({
                avatarUrl: '',
                name: 'Guest',
                level: 1,
                percentToNext: 0,
                showLevel: false,
            });
            if (userStatsLink) userStatsLink.setAttribute('href', '/signin');
        }
    }

    function boot() {
        // Paint a correct avatar shell immediately (before auth resolves)
        mountAccountAvatar({
            avatarUrl: '',
            name: 'Guest',
            level: 1,
            percentToNext: 0,
            showLevel: false,
        });

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
                // In-place ring/level updates — does not recreate the photo <img>
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
