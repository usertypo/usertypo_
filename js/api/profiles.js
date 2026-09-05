/**
 * Profile helpers — ensure / load the signed-in user's row in public.profiles
 * Public API: window.usertypoProfiles
 */
(function () {
    var STORAGE_KEY = 'usertypo:profile-cache:v1';
    var lastSyncedUserId = null;
    var syncInFlight = null;
    var cachedProfile = null;
    var lastFingerprint = null;

    function sanitizePublicUsername(raw) {
        return String(raw || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_+/g, '')
            .slice(0, 32);
    }

    /** Clerk fills a hidden unique username like u123456789; never use it as the public name. */
    function isPlaceholderUsername(raw) {
        var name = String(raw || '').trim();
        if (!name) return true;
        if (window.usertypoAuth && typeof window.usertypoAuth.isInternalClerkUsername === 'function') {
            return window.usertypoAuth.isInternalClerkUsername(name);
        }
        return /^u\d{8,10}$/i.test(name);
    }

    function pickUsername(user) {
        // Preferred name from in-progress sign-up / OAuth chooser wins over Clerk.
        if (window.usertypoAuth && typeof window.usertypoAuth.getPendingDisplayUsername === 'function') {
            var pending = sanitizePublicUsername(window.usertypoAuth.getPendingDisplayUsername());
            if (pending && pending.length >= 3 && !isPlaceholderUsername(pending)) {
                return pending;
            }
        }
        if (!user) return null;
        // App username only — never Google/OAuth fullName or firstName.
        // Also skip Clerk's auto-generated placeholder usernames.
        if (user.username) {
            var fromClerk = sanitizePublicUsername(user.username);
            if (fromClerk && !isPlaceholderUsername(fromClerk)) return fromClerk;
        }
        return null;
    }

    /** Public-facing name for any profile-like object. Never returns Google display names. */
    function publicUsername(source, fallback) {
        if (!source || typeof source !== 'object') return fallback || 'Player';
        var name = String(source.username || '').trim();
        if (name) return name;
        return fallback || 'Player';
    }

    function pickAvatar(user) {
        // Real photos only: Google/OAuth profile pics and uploaded images set hasImage=true.
        // Clerk's generated colorful silhouette (no Gmail pic) has hasImage=false → use default icon.
        if (!user || user.hasImage !== true) return null;
        return user.imageUrl || null;
    }

    function userFingerprint(user) {
        if (!user) return '';
        var email = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
        return [
            user.id,
            user.username || '',
            user.hasImage ? '1' : '0',
            user.imageUrl || '',
            email || '',
        ].join('|');
    }

    function clearProfileCache() {
        cachedProfile = null;
        lastFingerprint = null;
        lastSyncedUserId = null;
        window.__USERTYPO_PROFILE__ = null;
        if (window.usertypoProgression && typeof window.usertypoProgression.clearCache === 'function') {
            window.usertypoProgression.clearCache();
        }
    }

    function readStoredProfiles() {
        try {
            var raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function writeStoredProfiles(map) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map || {}));
        } catch (e) { /* ignore storage failures */ }
    }

    function loadStoredProfile(userId, fingerprint) {
        if (!userId || !fingerprint) return null;
        var entries = readStoredProfiles();
        var entry = entries[userId];
        if (!entry || entry.fingerprint !== fingerprint || !entry.profile) {
            return null;
        }
        return entry.profile;
    }

    function storeProfile(userId, fingerprint, profile) {
        if (!userId || !fingerprint || !profile) return;
        var entries = readStoredProfiles();
        entries[userId] = {
            fingerprint: fingerprint,
            profile: profile,
        };
        writeStoredProfiles(entries);
    }

    function hydrateProfileCache(user, fingerprint) {
        if (!user || !user.id || !fingerprint) return null;
        var storedProfile = loadStoredProfile(user.id, fingerprint);
        if (!storedProfile) return null;

        cachedProfile = storedProfile;
        lastFingerprint = fingerprint;
        lastSyncedUserId = user.id;
        window.__USERTYPO_PROFILE__ = storedProfile;
        return storedProfile;
    }

    function notifyProfileSynced(profile) {
        window.__USERTYPO_PROFILE__ = profile;
        try {
            window.dispatchEvent(new CustomEvent('usertypo:profile-synced', { detail: { profile: profile } }));
        } catch (e) { /* ignore */ }
    }

    async function detectCountryCode() {
        try {
            var res = await fetch('/api/geo', {
                method: 'GET',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) return null;
            var data = await res.json();
            var code = String((data && data.country) || '').trim().toUpperCase();
            if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
            return code;
        } catch (e) {
            return null;
        }
    }

    async function ensureCountryOnProfile(profile) {
        if (!profile || profile.country_code) return profile;
        var code = await detectCountryCode();
        if (!code) return profile;
        try {
            return await updateMyProfileFields({ country_code: code });
        } catch (e) {
            return profile;
        }
    }

    async function getMyProfile() {
        if (cachedProfile) return cachedProfile;
        if (window.__USERTYPO_PROFILE__) return window.__USERTYPO_PROFILE__;
        if (window.usertypoAuth && typeof window.usertypoAuth.getState === 'function') {
            var authState = window.usertypoAuth.getState();
            if (authState && authState.isSignedIn && authState.user) {
                var hydrated = hydrateProfileCache(authState.user, userFingerprint(authState.user));
                if (hydrated) return hydrated;
            }
        }
        if (!window.usertypoDb) throw new Error('usertypoDb is not loaded');
        var client = await window.usertypoDb.getClient();
        var result = await client.from('profiles').select('*').maybeSingle();
        if (result.error) throw result.error;
        cachedProfile = result.data || null;
        window.__USERTYPO_PROFILE__ = cachedProfile;
        return cachedProfile;
    }

    async function ensureMyProfile(user, options) {
        if (!user || !user.id) return null;
        if (!window.usertypoDb) throw new Error('usertypoDb is not loaded');

        var force = !!(options && options.force);
        var fingerprint = userFingerprint(user);

        if (!force && cachedProfile && cachedProfile.user_id === user.id && lastFingerprint === fingerprint) {
            if (cachedProfile.public_id) return ensureCountryOnProfile(cachedProfile);
            force = true;
        }

        if (!force) {
            var hydratedProfile = hydrateProfileCache(user, fingerprint);
            if (hydratedProfile && hydratedProfile.public_id) {
                notifyProfileSynced(hydratedProfile);
                return ensureCountryOnProfile(hydratedProfile);
            }
        }

        if (syncInFlight && lastSyncedUserId === user.id) {
            if (!force) {
                return ensureCountryOnProfile(await syncInFlight);
            }
            // Forced refresh must not reuse a stale in-flight sync (e.g. username change
            // while settings/auth are still hydrating the previous profile).
            try {
                await syncInFlight;
            } catch (e) { /* continue with a fresh sync */ }
        }

        lastSyncedUserId = user.id;
        syncInFlight = (async function () {
            var client = await window.usertypoDb.getClient();
            var existing = await client.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
            if (existing.error) throw existing.error;

            var username = pickUsername(user);
            var avatarUrl = pickAvatar(user);

            if (existing.data) {
                var nextAvatar = avatarUrl || null;
                // Drop Clerk-generated defaults previously mirrored into the row.
                if (!avatarUrl && existing.data.avatar_url) {
                    nextAvatar = null;
                }

                // Re-read before committing — applyDisplayUsername / setUsername may have
                // already replaced a Clerk placeholder while this sync was in flight.
                var latest = await client.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
                if (latest.error) throw latest.error;
                if (latest.data) existing = latest;

                var existingIsPlaceholder = isPlaceholderUsername(existing.data.username);
                var preferred = username && !isPlaceholderUsername(username) ? username : null;
                // Once a real app username exists, it is app-managed (setUsername / settings).
                // Placeholder u##### rows must be replaced when a preferred display name exists.
                var nextUsername = existingIsPlaceholder
                    ? (preferred || existing.data.username)
                    : (existing.data.username || preferred);
                // Keep display_name mirrored to username so Google names never linger.
                var nextDisplayName = nextUsername || existing.data.username || null;

                var needsUpdate =
                    (nextUsername && existing.data.username !== nextUsername) ||
                    (existing.data.avatar_url || null) !== (nextAvatar || null) ||
                    (nextDisplayName && existing.data.display_name !== nextDisplayName);

                // Never write a Clerk placeholder over a real username that landed concurrently.
                if (
                    needsUpdate
                    && isPlaceholderUsername(nextUsername)
                    && existing.data.username
                    && !isPlaceholderUsername(existing.data.username)
                ) {
                    needsUpdate = (existing.data.avatar_url || null) !== (nextAvatar || null);
                    nextUsername = existing.data.username;
                    nextDisplayName = existing.data.username;
                }

                if (!needsUpdate) {
                    cachedProfile = existing.data;
                    lastFingerprint = fingerprint;
                    storeProfile(user.id, fingerprint, existing.data);
                    notifyProfileSynced(existing.data);
                    return existing.data;
                }

                var updated = await client
                    .from('profiles')
                    .update({
                        username: nextUsername || existing.data.username,
                        display_name: nextDisplayName || existing.data.username || existing.data.display_name,
                        avatar_url: nextAvatar,
                    })
                    .eq('user_id', user.id)
                    .select('*')
                    .single();

                if (updated.error) throw updated.error;
                cachedProfile = updated.data;
                lastFingerprint = fingerprint;
                storeProfile(user.id, fingerprint, updated.data);
                notifyProfileSynced(updated.data);
                return updated.data;
            }

            if (!username || isPlaceholderUsername(username)) {
                // Wait for username choice / preferred display name — never insert Clerk's u#####.
                throw new Error('username_required');
            }

            var inserted = await client
                .from('profiles')
                .insert({
                    user_id: user.id,
                    username: username,
                    display_name: username,
                    avatar_url: avatarUrl,
                })
                .select('*')
                .single();

            if (inserted.error) throw inserted.error;
            cachedProfile = inserted.data;
            lastFingerprint = fingerprint;
            storeProfile(user.id, fingerprint, inserted.data);
            notifyProfileSynced(inserted.data);
            return inserted.data;
        })();

        try {
            return await ensureCountryOnProfile(await syncInFlight);
        } catch (err) {
            lastSyncedUserId = null;
            throw err;
        } finally {
            syncInFlight = null;
        }
    }

    async function requireSignedInUser() {
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

    async function updateMyProfileFields(patch) {
        var user = await requireSignedInUser();
        var client = await window.usertypoDb.getClient();
        var updated = await client
            .from('profiles')
            .update(patch || {})
            .eq('user_id', user.id)
            .select('*')
            .single();

        if (updated.error) throw updated.error;

        cachedProfile = updated.data;
        lastFingerprint = userFingerprint(user);
        lastSyncedUserId = user.id;
        storeProfile(user.id, lastFingerprint, updated.data);
        notifyProfileSynced(updated.data);
        return updated.data;
    }

    /**
     * Update leaderboard privacy preference in Postgres, then sync the worker.
     */
    async function setShowOnLeaderboard(enabled) {
        var show = !!enabled;
        var profile = await updateMyProfileFields({ show_on_leaderboard: show });

        var visibilitySync = null;
        if (window.usertypoLeaderboards && typeof window.usertypoLeaderboards.syncVisibility === 'function') {
            visibilitySync = await window.usertypoLeaderboards.syncVisibility(show);
        }

        console.info(
            '[usertypo profiles] show_on_leaderboard =',
            show,
            visibilitySync && visibilitySync.ok ? '(worker synced)' : '(worker sync skipped/failed)'
        );

        return {
            profile: profile,
            visibilitySync: visibilitySync,
        };
    }

    async function setAllowFriendRequests(enabled) {
        var allow = !!enabled;
        var profile = await updateMyProfileFields({ allow_friend_requests: allow });
        console.info('[usertypo profiles] allow_friend_requests =', allow);
        return { profile: profile };
    }

    async function setProfileVisibility(visibility) {
        var value = String(visibility || 'public').trim().toLowerCase();
        if (value === 'friends only' || value === 'friends_only') value = 'friends';
        if (value !== 'public' && value !== 'friends' && value !== 'private') {
            throw new Error('invalid_visibility');
        }
        var profile = await updateMyProfileFields({ profile_visibility: value });
        console.info('[usertypo profiles] profile_visibility =', value);
        return { profile: profile };
    }

    async function setUsername(username) {
        var name = sanitizePublicUsername(username);
        if (name.length < 3 || name.length > 32) {
            throw new Error('form_username_invalid_length');
        }
        if (isPlaceholderUsername(name)) {
            throw new Error('form_username_invalid_length');
        }

        var user = await requireSignedInUser();
        var client = await window.usertypoDb.getClient();
        var existing = await client.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
        if (existing.error) throw existing.error;

        var result;
        if (existing.data) {
            result = await client
                .from('profiles')
                .update({
                    username: name,
                    display_name: name,
                })
                .eq('user_id', user.id)
                .select('*')
                .single();
        } else {
            result = await client
                .from('profiles')
                .insert({
                    user_id: user.id,
                    username: name,
                    display_name: name,
                    avatar_url: pickAvatar(user),
                })
                .select('*')
                .single();

            // Concurrent ensureMyProfile may have inserted first — fall back to update.
            if (result.error && (result.error.code === '23505' || /duplicate|unique/i.test(String(result.error.message || '')))) {
                result = await client
                    .from('profiles')
                    .update({
                        username: name,
                        display_name: name,
                    })
                    .eq('user_id', user.id)
                    .select('*')
                    .single();
            }
        }

        if (result.error) throw result.error;

        cachedProfile = result.data;
        lastFingerprint = userFingerprint(user);
        lastSyncedUserId = user.id;
        storeProfile(user.id, lastFingerprint, result.data);
        notifyProfileSynced(result.data);
        console.info('[usertypo profiles] username =', name);
        return { profile: result.data };
    }

    async function updateMyAvatar(file) {
        var user = await requireSignedInUser();
        if (!file) throw new Error('missing_file');
        var maxBytes = 5 * 1024 * 1024;
        if (file.size > maxBytes) throw new Error('file_too_large');
        var type = String(file.type || '').toLowerCase();
        if (type && type.indexOf('image/') !== 0) throw new Error('invalid_file_type');

        if (typeof user.setProfileImage !== 'function') {
            throw new Error('avatar_upload_unavailable');
        }
        await user.setProfileImage({ file: file });
        if (typeof user.reload === 'function') {
            await user.reload();
        }
        var refreshed = window.usertypoAuth && window.usertypoAuth.getState
            ? (window.usertypoAuth.getState().user || user)
            : user;
        var profile = await ensureMyProfile(refreshed, { force: true });
        return { profile: profile, imageUrl: pickAvatar(refreshed) };
    }

    async function removeMyAvatar() {
        var user = await requireSignedInUser();
        if (typeof user.setProfileImage !== 'function') {
            throw new Error('avatar_upload_unavailable');
        }
        await user.setProfileImage({ file: null });
        if (typeof user.reload === 'function') {
            await user.reload();
        }
        var refreshed = window.usertypoAuth && window.usertypoAuth.getState
            ? (window.usertypoAuth.getState().user || user)
            : user;
        var profile = await ensureMyProfile(refreshed, { force: true });
        return { profile: profile, imageUrl: null };
    }

    function bindAuthSync() {
        if (!window.usertypoAuth) return;

        window.usertypoAuth.onChange(function (state) {
            if (!state || !state.isSignedIn || !state.user) {
                clearProfileCache();
                return;
            }

            ensureMyProfile(state.user)
                .then(function (profile) {
                    console.info(
                        '[usertypo profiles] synced',
                        profile && profile.username ? profile.username : '(no username)',
                        profile && profile.user_id ? '(' + profile.user_id + ')' : '',
                        profile && profile.country_code ? '[' + profile.country_code + ']' : '[no country]'
                    );
                    if (window.usertypoProgression && typeof window.usertypoProgression.getMine === 'function') {
                        return window.usertypoProgression.getMine({ force: true }).catch(function (err) {
                            console.warn('[usertypo progression] load failed', err);
                        });
                    }
                })
                .catch(function (err) {
                    if (err && err.message === 'username_required') {
                        // Normal during sign-up before the display-name step finishes.
                        return;
                    }
                    var details = err;
                    if (err && typeof err === 'object') {
                        details = {
                            message: err.message,
                            code: err.code,
                            details: err.details,
                            hint: err.hint,
                            status: err.status,
                        };
                    }
                    console.error('[usertypo profiles] sync failed', details);
                    if (window.usertypoDb && typeof window.usertypoDb.debugAuth === 'function') {
                        window.usertypoDb.debugAuth();
                    }
                });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindAuthSync);
    } else {
        bindAuthSync();
    }

    window.usertypoProfiles = {
        getMyProfile: getMyProfile,
        ensureMyProfile: ensureMyProfile,
        setShowOnLeaderboard: setShowOnLeaderboard,
        setAllowFriendRequests: setAllowFriendRequests,
        setProfileVisibility: setProfileVisibility,
        setUsername: setUsername,
        updateMyAvatar: updateMyAvatar,
        removeMyAvatar: removeMyAvatar,
        clearCache: clearProfileCache,
        publicUsername: publicUsername,
    };
})();
