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

    function pickUsername(user) {
        if (!user) return null;
        if (user.username) return user.username;
        if (user.fullName) return user.fullName;
        if (user.firstName) return user.firstName;
        var email = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
        if (email) return email.split('@')[0];
        return null;
    }

    function pickAvatar(user) {
        return (user && user.imageUrl) || null;
    }

    function userFingerprint(user) {
        if (!user) return '';
        var email = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
        return [
            user.id,
            user.username || '',
            user.fullName || '',
            user.firstName || '',
            user.imageUrl || '',
            email || '',
        ].join('|');
    }

    function clearProfileCache() {
        cachedProfile = null;
        lastFingerprint = null;
        lastSyncedUserId = null;
        window.__USERTYPO_PROFILE__ = null;
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
            return cachedProfile;
        }

        if (!force) {
            var hydratedProfile = hydrateProfileCache(user, fingerprint);
            if (hydratedProfile) {
                notifyProfileSynced(hydratedProfile);
                return hydratedProfile;
            }
        }

        if (syncInFlight && lastSyncedUserId === user.id) {
            return syncInFlight;
        }

        lastSyncedUserId = user.id;
        syncInFlight = (async function () {
            var client = await window.usertypoDb.getClient();
            var existing = await client.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
            if (existing.error) throw existing.error;

            var username = pickUsername(user);
            var avatarUrl = pickAvatar(user);
            var displayName = user.fullName || username;

            if (existing.data) {
                var needsUpdate =
                    (username && existing.data.username !== username) ||
                    (avatarUrl && existing.data.avatar_url !== avatarUrl) ||
                    (displayName && existing.data.display_name !== displayName);

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
                        username: username || existing.data.username,
                        display_name: displayName || existing.data.display_name,
                        avatar_url: avatarUrl || existing.data.avatar_url,
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

            var inserted = await client
                .from('profiles')
                .insert({
                    user_id: user.id,
                    username: username,
                    display_name: displayName,
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
            return await syncInFlight;
        } catch (err) {
            lastSyncedUserId = null;
            throw err;
        } finally {
            syncInFlight = null;
        }
    }

    /**
     * Update leaderboard privacy preference in Postgres, then sync Redis.
     */
    async function setShowOnLeaderboard(enabled) {
        if (!window.usertypoAuth || !window.usertypoDb) {
            throw new Error('auth_or_db_missing');
        }

        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            throw new Error('guest');
        }

        var user = state.user;
        var show = !!enabled;
        var client = await window.usertypoDb.getClient();
        var updated = await client
            .from('profiles')
            .update({ show_on_leaderboard: show })
            .eq('user_id', user.id)
            .select('*')
            .single();

        if (updated.error) throw updated.error;

        cachedProfile = updated.data;
        lastFingerprint = userFingerprint(user);
        lastSyncedUserId = user.id;
        storeProfile(user.id, lastFingerprint, updated.data);
        notifyProfileSynced(updated.data);

        var redisSync = null;
        if (window.usertypoLeaderboards && typeof window.usertypoLeaderboards.syncVisibility === 'function') {
            redisSync = await window.usertypoLeaderboards.syncVisibility(show);
        }

        console.info(
            '[usertypo profiles] show_on_leaderboard =',
            show,
            redisSync && redisSync.ok ? '(redis synced)' : '(redis sync skipped/failed)'
        );

        return {
            profile: updated.data,
            redisSync: redisSync,
        };
    }

    function bindAuthSync() {
        if (!window.usertypoAuth) return;

        window.usertypoAuth.onChange(function (state) {
            if (!state || !state.isSignedIn || !state.user) {
                clearProfileCache();
                return;
            }

            var fingerprint = userFingerprint(state.user);
            if (cachedProfile && cachedProfile.user_id === state.user.id && lastFingerprint === fingerprint) {
                return;
            }

            ensureMyProfile(state.user)
                .then(function (profile) {
                    console.info(
                        '[usertypo profiles] synced',
                        profile && profile.username ? profile.username : '(no username)',
                        profile && profile.user_id ? '(' + profile.user_id + ')' : ''
                    );
                })
                .catch(function (err) {
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
        clearCache: clearProfileCache,
    };
})();
