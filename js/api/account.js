/**
 * Account wipe helpers — reset linked data or fully delete account data.
 * Public API: window.usertypoAccount
 */
(function () {
    function mapRpcError(err) {
        var raw = (err && err.message) ? String(err.message) : String(err || 'Unknown error');
        var match = raw.match(/(?:ERROR:\s*)?(\w+)/i);
        var code = match ? match[1] : '';
        var friendly = {
            not_authenticated: 'Sign in to manage your account.',
            guest: 'Sign in to manage your account.',
            user_not_found: 'Account not found.',
            delete_self_disabled: 'Account deletion is disabled for this user. Enable “Allow users to delete their accounts” in Clerk.',
        };
        return {
            error: err,
            code: code,
            message: friendly[code] || raw,
        };
    }

    async function requireAuth() {
        if (!window.usertypoAuth || !window.usertypoDb) {
            throw new Error('auth_or_db_missing');
        }
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            throw new Error('guest');
        }
        return state;
    }

    async function clearClientCaches() {
        try {
            if (window.usertypoProfiles && typeof window.usertypoProfiles.clearCache === 'function') {
                window.usertypoProfiles.clearCache();
            }
        } catch (e) { /* ignore */ }
        try {
            if (window.usertypoProgression && typeof window.usertypoProgression.clearCache === 'function') {
                window.usertypoProgression.clearCache();
            }
        } catch (e) { /* ignore */ }
        try {
            window.dispatchEvent(new CustomEvent('usertypo:friends-changed'));
            window.dispatchEvent(new CustomEvent('usertypo:account-data-cleared'));
        } catch (e) { /* ignore */ }
    }

    async function purgeLeaderboards() {
        if (window.usertypoLeaderboards && typeof window.usertypoLeaderboards.syncVisibility === 'function') {
            try {
                await window.usertypoLeaderboards.syncVisibility(false);
            } catch (err) {
                console.warn('[usertypo account] leaderboard purge failed', err);
            }
        }
    }

    async function resetAccountData() {
        await requireAuth();
        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('reset_my_account_data');
        if (result.error) throw result.error;

        await purgeLeaderboards();
        // Keep profile privacy preference for leaderboards if still opted in.
        try {
            var profile = window.__USERTYPO_PROFILE__;
            if (profile && profile.show_on_leaderboard !== false && window.usertypoLeaderboards) {
                await window.usertypoLeaderboards.syncVisibility(true);
            }
        } catch (e) { /* ignore */ }

        await clearClientCaches();
        if (window.usertypoAuth) {
            var state = window.usertypoAuth.getState();
            if (state.user && window.usertypoProfiles) {
                try {
                    await window.usertypoProfiles.ensureMyProfile(state.user, { force: true });
                } catch (e) { /* ignore */ }
            }
            if (window.usertypoProgression && typeof window.usertypoProgression.getMine === 'function') {
                try {
                    await window.usertypoProgression.getMine({ force: true });
                } catch (e) { /* ignore */ }
            }
        }

        return result.data || { ok: true };
    }

    async function deleteAccount() {
        var state = await requireAuth();
        var client = await window.usertypoDb.getClient();

        await purgeLeaderboards();

        var result = await client.rpc('delete_my_account_data');
        if (result.error) throw result.error;

        await clearClientCaches();

        // Clear local settings so a new signup starts clean on this device.
        try {
            window.localStorage.removeItem('usertypo_settings');
            window.localStorage.removeItem('usertypo:profile-cache:v1');
        } catch (e) { /* ignore */ }

        var user = state.user;
        if (!user || typeof user.delete !== 'function') {
            throw new Error('delete_self_disabled');
        }
        if (user.deleteSelfEnabled === false) {
            throw new Error('delete_self_disabled');
        }

        await user.delete();
        return { ok: true };
    }

    window.usertypoAccount = {
        resetAccountData: resetAccountData,
        deleteAccount: deleteAccount,
        mapRpcError: mapRpcError,
    };
})();
