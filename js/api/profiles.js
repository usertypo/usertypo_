/**
 * Profile helpers — ensure / load the signed-in user's row in public.profiles
 * Public API: window.usertypoProfiles
 */
(function () {
    var lastSyncedUserId = null;
    var syncInFlight = null;

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

    async function getMyProfile() {
        if (!window.usertypoDb) throw new Error('usertypoDb is not loaded');
        var client = await window.usertypoDb.getClient();
        var result = await client.from('profiles').select('*').maybeSingle();
        if (result.error) throw result.error;
        return result.data || null;
    }

    async function ensureMyProfile(user) {
        if (!user || !user.id) return null;
        if (!window.usertypoDb) throw new Error('usertypoDb is not loaded');

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

                if (!needsUpdate) return existing.data;

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

    function bindAuthSync() {
        if (!window.usertypoAuth) return;

        window.usertypoAuth.onChange(function (state) {
            if (!state || !state.isSignedIn || !state.user) {
                lastSyncedUserId = null;
                return;
            }

            ensureMyProfile(state.user)
                .then(function (profile) {
                    window.__USERTYPO_PROFILE__ = profile;
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
    };
})();
