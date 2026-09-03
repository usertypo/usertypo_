/**
 * Account Settings helpers — username/email/password, PBs reset, logout-all, blocked list.
 * Public API: window.usertypoAccount (extends wipe helpers)
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
            form_identifier_exists: 'That username or email is already taken.',
            form_password_incorrect: 'Current password is incorrect.',
            form_password_pwned: 'That password has appeared in a data breach. Choose another.',
            form_password_length_too_short: 'Password is too short.',
            form_param_format_invalid: 'That value is not valid.',
            form_username_invalid_length: 'Username must be between 3 and 32 characters.',
            verification_required: 'Enter the verification code sent to your new email.',
            verification_cancelled: 'Cancelled — identity verification was not completed.',
            session_reverification_required: 'Verify your identity (Google / email), then try again.',
            leaderboard_purge_failed: 'Could not remove your leaderboard scores. Try again in a moment.',
            leaderboard_purge_unavailable: 'Leaderboard cleanup is unavailable. Try again in a moment.',
        };
        if (friendly[code]) {
            return { error: err, code: code, message: friendly[code] };
        }
        if (window.usertypoAuth && typeof window.usertypoAuth.isReverificationError === 'function'
            && window.usertypoAuth.isReverificationError(err)) {
            return {
                error: err,
                code: 'session_reverification_required',
                message: friendly.session_reverification_required,
            };
        }
        if (window.usertypoAuth && typeof window.usertypoAuth.formatError === 'function') {
            return { error: err, code: code, message: window.usertypoAuth.formatError(err) };
        }
        return { error: err, code: code, message: raw };
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

    function clearLocalAccountArtifacts() {
        var keys = [
            'usertypo_settings',
            'usertypo:profile-cache:v1',
            'usertypo_pace_history_v1',
            'usertypo_pot_filters',
            'usertypo_pot_chart',
            'usertypo_pot_presets',
            'usertypo_auth_welcome',
        ];
        keys.forEach(function (key) {
            try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
        });
    }

    async function purgeLeaderboards(options) {
        var required = !!(options && options.required);
        if (!window.usertypoLeaderboards || typeof window.usertypoLeaderboards.syncVisibility !== 'function') {
            if (required) throw new Error('leaderboard_purge_unavailable');
            return { ok: false, skipped: true };
        }
        try {
            var result = await window.usertypoLeaderboards.syncVisibility(false);
            if (result && result.ok) return { ok: true, data: result.data || null };
            if (required) throw new Error('leaderboard_purge_failed');
            return { ok: false, details: result };
        } catch (err) {
            console.warn('[usertypo account] leaderboard purge failed', err);
            if (required) throw err.code ? err : new Error('leaderboard_purge_failed');
            return { ok: false, error: err };
        }
    }

    async function syncProfileFromClerk(user) {
        if (!user || !window.usertypoProfiles) return null;
        return window.usertypoProfiles.ensureMyProfile(user, { force: true });
    }

    /**
     * Run a Clerk-sensitive action; if the session is stale, open reverification and retry once.
     * Google-only accounts re-verify via Google (no password required).
     */
    async function withReverification(action, level) {
        var run = typeof action === 'function' ? action : null;
        if (!run) throw new Error('invalid_action');

        try {
            return await run();
        } catch (err) {
            var auth = window.usertypoAuth;
            if (!auth
                || typeof auth.isReverificationError !== 'function'
                || !auth.isReverificationError(err)
                || typeof auth.ensureReverified !== 'function') {
                throw err;
            }
            await auth.ensureReverified(level || 'first_factor');
            return await run();
        }
    }

    async function updateUsername(username) {
        var state = await requireAuth();
        var name = String(username || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_+/g, '')
            .slice(0, 32);
        if (name.length < 3 || name.length > 32) {
            throw new Error('form_username_invalid_length');
        }

        if (typeof state.user.update !== 'function') {
            throw new Error('Could not update account name.');
        }

        await withReverification(async function () {
            var user = window.usertypoAuth.getState().user;
            if (!user || typeof user.update !== 'function') {
                throw new Error('Could not update account name.');
            }
            await user.update({ username: name });
            if (typeof user.reload === 'function') {
                await user.reload();
            }
        }, 'first_factor');

        var user = window.usertypoAuth.getState().user;

        // Profiles row is the display source of truth for the app UI.
        // Do not call ensureMyProfile afterward — a concurrent/stale Clerk sync
        // used to overwrite the new username in cache (and sometimes DB).
        var profileResult = null;
        if (window.usertypoProfiles && typeof window.usertypoProfiles.setUsername === 'function') {
            profileResult = await window.usertypoProfiles.setUsername(name);
        } else if (window.usertypoDb) {
            var client = await window.usertypoDb.getClient();
            var updated = await client
                .from('profiles')
                .update({ username: name, display_name: name })
                .eq('user_id', user.id)
                .select('*')
                .single();
            if (updated.error) throw updated.error;
            if (window.usertypoProfiles && typeof window.usertypoProfiles.clearCache === 'function') {
                window.usertypoProfiles.clearCache();
            }
            window.__USERTYPO_PROFILE__ = updated.data;
            try {
                window.dispatchEvent(new CustomEvent('usertypo:profile-synced', {
                    detail: { profile: updated.data },
                }));
            } catch (e) { /* ignore */ }
            profileResult = { profile: updated.data };
        }

        return {
            ok: true,
            username: name,
            profile: profileResult && profileResult.profile || null,
        };
    }

    /**
     * Start email change. May return needs_verification with a pending EmailAddress resource.
     */
    async function startEmailChange(newEmail) {
        var state = await requireAuth();
        var email = String(newEmail || '').trim().toLowerCase();
        if (!email || email.indexOf('@') < 1) {
            throw new Error('form_param_format_invalid');
        }

        var user = state.user;
        var current = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
        if (current && current.toLowerCase() === email) {
            return { ok: true, unchanged: true };
        }

        if (typeof user.createEmailAddress !== 'function') {
            throw new Error('Email changes are not available for this account.');
        }

        var emailAddress = await user.createEmailAddress({ email: email });
        if (emailAddress && typeof emailAddress.prepareVerification === 'function') {
            await emailAddress.prepareVerification({ strategy: 'email_code' });
        }

        return {
            ok: true,
            needs_verification: true,
            emailAddressId: emailAddress && emailAddress.id,
            email: email,
        };
    }

    async function confirmEmailChange(emailAddressId, code) {
        var state = await requireAuth();
        var user = state.user;
        var id = String(emailAddressId || '').trim();
        var verificationCode = String(code || '').trim();
        if (!id || !verificationCode) {
            throw new Error('verification_required');
        }

        var emailAddress = (user.emailAddresses || []).find(function (item) {
            return item && item.id === id;
        });
        if (!emailAddress) {
            throw new Error('Email address not found. Start the change again.');
        }

        await withReverification(async function () {
            var user = window.usertypoAuth.getState().user;
            var emailAddress = (user.emailAddresses || []).find(function (item) {
                return item && item.id === id;
            });
            if (!emailAddress) {
                throw new Error('Email address not found. Start the change again.');
            }

            if (typeof emailAddress.attemptVerification === 'function') {
                await emailAddress.attemptVerification({ code: verificationCode });
            }

            await user.update({ primaryEmailAddressId: id });
            if (typeof user.reload === 'function') {
                await user.reload();
            }
        }, 'first_factor');

        var user = window.usertypoAuth.getState().user;
        await syncProfileFromClerk(user);

        return {
            ok: true,
            email: user.primaryEmailAddress && user.primaryEmailAddress.emailAddress,
        };
    }

    async function updatePassword(currentPassword, newPassword) {
        var state = await requireAuth();
        var user = state.user;
        var next = String(newPassword || '');
        if (next.length < 8) {
            throw new Error('form_password_length_too_short');
        }
        if (typeof user.updatePassword !== 'function') {
            throw new Error('Password changes are not available for this account.');
        }

        var payload = { newPassword: next };
        if (user.passwordEnabled) {
            payload.currentPassword = String(currentPassword || '');
            if (!payload.currentPassword) {
                throw new Error('form_password_incorrect');
            }
        }

        await withReverification(async function () {
            var current = window.usertypoAuth.getState().user;
            if (!current || typeof current.updatePassword !== 'function') {
                throw new Error('Password changes are not available for this account.');
            }
            await current.updatePassword(payload);
        }, 'first_factor');
        return { ok: true };
    }

    async function logoutAllDevices() {
        var state = await requireAuth();
        var user = state.user;
        var clerk = state.clerk;
        var currentSessionId = clerk && clerk.session ? clerk.session.id : null;

        if (user && typeof user.getSessions === 'function') {
            try {
                var sessions = await user.getSessions();
                await Promise.all((sessions || []).map(function (session) {
                    if (!session || session.id === currentSessionId) return Promise.resolve();
                    if (typeof session.revoke === 'function') return session.revoke();
                    if (typeof session.end === 'function') return session.end();
                    if (typeof session.remove === 'function') return session.remove();
                    return Promise.resolve();
                }));
            } catch (err) {
                console.warn('[usertypo account] revoke other sessions failed', err);
            }
        }

        await window.usertypoAuth.signOut();
        return { ok: true };
    }

    async function listBlockedUsers() {
        await requireAuth();
        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('get_my_blocked_users');
        if (result.error) throw result.error;
        var data = result.data;
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return []; }
        }
        return [];
    }

    async function resetAccountData() {
        await requireAuth();
        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('reset_my_account_data');
        if (result.error) throw result.error;

        await purgeLeaderboards({ required: false });
        try {
            var profile = window.__USERTYPO_PROFILE__;
            if (profile && profile.show_on_leaderboard !== false && window.usertypoLeaderboards) {
                await window.usertypoLeaderboards.syncVisibility(true);
            }
        } catch (e) { /* ignore */ }

        await clearClientCaches();
        clearLocalAccountArtifacts();
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

    async function deleteClerkUser(user) {
        if (!user || typeof user.delete !== 'function') {
            throw new Error('delete_self_disabled');
        }
        if (user.deleteSelfEnabled === false) {
            throw new Error('delete_self_disabled');
        }
        await user.delete();
    }

    async function deleteAccount() {
        var state = await requireAuth();
        var user = state.user;
        if (!user || typeof user.delete !== 'function') {
            throw new Error('delete_self_disabled');
        }
        if (user.deleteSelfEnabled === false) {
            throw new Error('delete_self_disabled');
        }

        // Clerk blocks user.delete() unless credentials were verified recently.
        // Reverify *before* wiping app data so a cancelled/failed check leaves the account intact.
        if (window.usertypoAuth && typeof window.usertypoAuth.ensureReverified === 'function') {
            await window.usertypoAuth.ensureReverified('first_factor');
            state = window.usertypoAuth.getState();
            user = state.user;
        }

        var client = await window.usertypoDb.getClient();

        // Visibility sync needs a live profile JWT path before the row is deleted.
        await purgeLeaderboards({ required: true });

        var result = await client.rpc('delete_my_account_data');
        if (result.error) throw result.error;

        await clearClientCaches();
        clearLocalAccountArtifacts();

        state = window.usertypoAuth.getState();
        user = state.user;

        try {
            await deleteClerkUser(user);
        } catch (err) {
            if (window.usertypoAuth
                && typeof window.usertypoAuth.isReverificationError === 'function'
                && window.usertypoAuth.isReverificationError(err)
                && typeof window.usertypoAuth.ensureReverified === 'function') {
                await window.usertypoAuth.ensureReverified('first_factor');
                state = window.usertypoAuth.getState();
                await deleteClerkUser(state.user);
            } else {
                throw err;
            }
        }

        return { ok: true };
    }

    /**
     * Privacy export: test-history CSV + account summary JSON.
     */
    async function exportMyData() {
        await requireAuth();
        var state = window.usertypoAuth.getState();
        var user = state.user;
        var profile = window.__USERTYPO_PROFILE__ || null;
        if ((!profile || !profile.user_id) && window.usertypoProfiles && user) {
            try {
                profile = await window.usertypoProfiles.ensureMyProfile(user, { force: true });
            } catch (e) { /* ignore */ }
        }
        var progression = null;
        if (window.usertypoProgression && typeof window.usertypoProgression.getMine === 'function') {
            try {
                progression = await window.usertypoProgression.getMine({ force: true });
            } catch (e) { /* ignore */ }
        }

        var email = user && user.primaryEmailAddress && user.primaryEmailAddress.emailAddress
            ? user.primaryEmailAddress.emailAddress
            : null;

        var summary = {
            exported_at: new Date().toISOString(),
            account: {
                user_id: user && user.id || null,
                username: (profile && profile.username) || (user && user.username) || null,
                public_id: profile && profile.public_id || null,
                email: email,
                show_on_leaderboard: profile ? profile.show_on_leaderboard !== false : null,
                profile_visibility: profile && profile.profile_visibility || null,
                created_at: profile && profile.created_at || null,
            },
            progression: progression
                ? {
                    level: progression.level,
                    total_xp: progression.totalXp != null ? progression.totalXp : progression.total_xp,
                    current_streak: progression.currentStreak != null ? progression.currentStreak : progression.current_streak,
                    longest_streak: progression.longestStreak != null ? progression.longestStreak : progression.longest_streak,
                }
                : null,
        };

        var dateStamp = new Date().toISOString().slice(0, 10);
        var jsonBlob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
        var jsonUrl = URL.createObjectURL(jsonBlob);
        var jsonLink = document.createElement('a');
        jsonLink.href = jsonUrl;
        jsonLink.download = 'usertypo-account-' + dateStamp + '.json';
        document.body.appendChild(jsonLink);
        jsonLink.click();
        jsonLink.remove();
        setTimeout(function () { URL.revokeObjectURL(jsonUrl); }, 0);

        var csvResult = { ok: true, skipped: true };
        if (window.usertypoSessions && typeof window.usertypoSessions.exportTestHistoryCsv === 'function') {
            csvResult = await window.usertypoSessions.exportTestHistoryCsv();
            if (csvResult && csvResult.error && csvResult.error !== 'no_sessions') {
                throw new Error(csvResult.message || 'Could not export test history.');
            }
        }

        return {
            ok: true,
            account_export: true,
            history: csvResult && csvResult.error === 'no_sessions'
                ? { skipped: true, reason: 'no_sessions' }
                : csvResult,
        };
    }

    window.usertypoAccount = {
        updateUsername: updateUsername,
        startEmailChange: startEmailChange,
        confirmEmailChange: confirmEmailChange,
        updatePassword: updatePassword,
        logoutAllDevices: logoutAllDevices,
        listBlockedUsers: listBlockedUsers,
        resetAccountData: resetAccountData,
        deleteAccount: deleteAccount,
        exportMyData: exportMyData,
        mapRpcError: mapRpcError,
    };
})();
