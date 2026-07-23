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
        };
        if (friendly[code]) {
            return { error: err, code: code, message: friendly[code] };
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

    async function purgeLeaderboards() {
        if (window.usertypoLeaderboards && typeof window.usertypoLeaderboards.syncVisibility === 'function') {
            try {
                await window.usertypoLeaderboards.syncVisibility(false);
            } catch (err) {
                console.warn('[usertypo account] leaderboard purge failed', err);
            }
        }
    }

    async function syncProfileFromClerk(user) {
        if (!user || !window.usertypoProfiles) return null;
        return window.usertypoProfiles.ensureMyProfile(user, { force: true });
    }

    async function updateUsername(username) {
        var state = await requireAuth();
        var name = String(username || '').trim();
        if (name.length < 3 || name.length > 32) {
            throw new Error('form_username_invalid_length');
        }

        var user = state.user;
        if (typeof user.update !== 'function') {
            throw new Error('Could not update account name.');
        }

        await user.update({ username: name });
        await user.reload();

        if (window.usertypoProfiles && typeof window.usertypoProfiles.setUsername === 'function') {
            await window.usertypoProfiles.setUsername(name);
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
        }

        await syncProfileFromClerk(user);
        return { ok: true, username: name };
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

        if (typeof emailAddress.attemptVerification === 'function') {
            await emailAddress.attemptVerification({ code: verificationCode });
        }

        await user.update({ primaryEmailAddressId: id });
        await user.reload();
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

        await user.updatePassword(payload);
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

        await purgeLeaderboards();
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
        updateUsername: updateUsername,
        startEmailChange: startEmailChange,
        confirmEmailChange: confirmEmailChange,
        updatePassword: updatePassword,
        logoutAllDevices: logoutAllDevices,
        listBlockedUsers: listBlockedUsers,
        resetAccountData: resetAccountData,
        deleteAccount: deleteAccount,
        mapRpcError: mapRpcError,
    };
})();
