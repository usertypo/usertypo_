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

    /**
     * Run a Clerk-sensitive action; if the session is stale, open reverification and retry once.
     * Google-only accounts re-verify via Google (no password required).
     */
    async function withReverification(action, level) {
        var run = typeof action === 'function' ? action : null;
        if (!run) throw new Error('invalid_action');

        try {
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'A',location:'account.js:withReverification',message:'first attempt start',data:{level:level||'first_factor'},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            return await run();
        } catch (err) {
            var auth = window.usertypoAuth;
            var isRev = !!(auth && typeof auth.isReverificationError === 'function' && auth.isReverificationError(err));
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'A',location:'account.js:withReverification',message:'first attempt failed',data:{isRev:isRev,errMsg:String(err&&err.message||err).slice(0,160),errCode:err&&err.errors&&err.errors[0]&&err.errors[0].code||null},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            if (!auth
                || typeof auth.isReverificationError !== 'function'
                || !auth.isReverificationError(err)
                || typeof auth.ensureReverified !== 'function') {
                throw err;
            }
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'D',location:'account.js:withReverification',message:'calling ensureReverified before retry',data:{level:level||'first_factor'},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            await auth.ensureReverified(level || 'first_factor');
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'D',location:'account.js:withReverification',message:'ensureReverified resolved; retrying action',data:{},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            try {
                return await run();
            } catch (retryErr) {
                // #region agent log
                fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'E',location:'account.js:withReverification',message:'retry after reverify failed',data:{errMsg:String(retryErr&&retryErr.message||retryErr).slice(0,160),errCode:retryErr&&retryErr.errors&&retryErr.errors[0]&&retryErr.errors[0].code||null,isRev:!!(auth.isReverificationError&&auth.isReverificationError(retryErr))},timestamp:Date.now()})}).catch(function(){});
                // #endregion
                throw retryErr;
            }
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
            .replace(/^_+|_+$/g, '')
            .slice(0, 32);
        if (name.length < 3 || name.length > 32) {
            throw new Error('form_username_invalid_length');
        }

        if (typeof state.user.update !== 'function') {
            throw new Error('Could not update account name.');
        }

        // #region agent log
        fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'B',location:'account.js:updateUsername',message:'updateUsername start',data:{requestedLen:(username||'').length,sanitizedLen:name.length,clerkBefore:state.user&&state.user.username||null,profileBefore:(window.__USERTYPO_PROFILE__&&window.__USERTYPO_PROFILE__.username)||null,passwordEnabled:!!(state.user&&state.user.passwordEnabled)},timestamp:Date.now()})}).catch(function(){});
        // #endregion

        await withReverification(async function () {
            var user = window.usertypoAuth.getState().user;
            if (!user || typeof user.update !== 'function') {
                throw new Error('Could not update account name.');
            }
            await user.update({ username: name });
            if (typeof user.reload === 'function') {
                await user.reload();
            }
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'B',location:'account.js:updateUsername',message:'Clerk user.update+reload ok',data:{clerkAfter:(window.usertypoAuth.getState().user&&window.usertypoAuth.getState().user.username)||null,expected:name},timestamp:Date.now()})}).catch(function(){});
            // #endregion
        }, 'first_factor');

        var user = window.usertypoAuth.getState().user;

        // Profiles row is the display source of truth for the app UI.
        // Do not call ensureMyProfile afterward — a concurrent/stale Clerk sync
        // used to overwrite the new username in cache (and sometimes DB).
        var profileResult = null;
        if (window.usertypoProfiles && typeof window.usertypoProfiles.setUsername === 'function') {
            profileResult = await window.usertypoProfiles.setUsername(name);
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'B',location:'account.js:updateUsername',message:'setUsername finished',data:{profileAfter:profileResult&&profileResult.profile&&profileResult.profile.username||null,expected:name,clerkNow:user&&user.username||null},timestamp:Date.now()})}).catch(function(){});
            // #endregion
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

        // #region agent log
        fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28f6bf'},body:JSON.stringify({sessionId:'28f6bf',runId:'pre-fix',hypothesisId:'C',location:'account.js:updateUsername',message:'updateUsername returning ok',data:{returnedUsername:name,profileUsername:(window.__USERTYPO_PROFILE__&&window.__USERTYPO_PROFILE__.username)||null,clerkUsername:(window.usertypoAuth.getState().user&&window.usertypoAuth.getState().user.username)||null},timestamp:Date.now()})}).catch(function(){});
        // #endregion

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
            await window.usertypoAuth.ensureReverified('multi_factor');
            state = window.usertypoAuth.getState();
            user = state.user;
        }

        var client = await window.usertypoDb.getClient();

        await purgeLeaderboards();

        var result = await client.rpc('delete_my_account_data');
        if (result.error) throw result.error;

        await clearClientCaches();

        try {
            window.localStorage.removeItem('usertypo_settings');
            window.localStorage.removeItem('usertypo:profile-cache:v1');
        } catch (e) { /* ignore */ }

        state = window.usertypoAuth.getState();
        user = state.user;

        try {
            await deleteClerkUser(user);
        } catch (err) {
            if (window.usertypoAuth
                && typeof window.usertypoAuth.isReverificationError === 'function'
                && window.usertypoAuth.isReverificationError(err)
                && typeof window.usertypoAuth.ensureReverified === 'function') {
                await window.usertypoAuth.ensureReverified('multi_factor');
                state = window.usertypoAuth.getState();
                await deleteClerkUser(state.user);
            } else {
                throw err;
            }
        }

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
