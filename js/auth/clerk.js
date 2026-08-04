/**
 * Auth client — Clerk load + session helpers.
 * Public API: window.usertypoAuth
 */
(function () {
    function getClerkConfig() {
        var root = window.USERTYPO_CONFIG || {};
        return root.clerk || window.USERTYPO_CLERK || null;
    }

    var config = getClerkConfig();
    if (!config || !config.publishableKey || !config.frontendApi) {
        console.error('[usertypo auth] Missing USERTYPO_CONFIG.clerk in js/config/public.js');
        return;
    }

    var readyPromise = null;
    var listeners = [];
    var pendingSignUp = null;

    function notify(state) {
        listeners.forEach(function (fn) {
            try {
                fn(state);
            } catch (err) {
                console.error('[usertypo auth] listener error', err);
            }
        });
    }

    function getClerk() {
        return window.Clerk || null;
    }

    function getState() {
        var clerk = getClerk();
        return {
            isLoaded: !!(clerk && clerk.loaded),
            isSignedIn: !!(clerk && clerk.user),
            user: (clerk && clerk.user) || null,
            clerk: clerk,
        };
    }

    function formatError(err) {
        if (!err) return 'Something went wrong. Please try again.';
        if (typeof err === 'string') return err;
        if (err.code === 'email_already_exists' && err.message) {
            return err.message;
        }
        if (isIdentifierExistsError(err)) {
            return EMAIL_EXISTS_MESSAGE;
        }
        if (err.errors && err.errors.length) {
            return err.errors.map(function (e) { return e.longMessage || e.message; }).join(' ');
        }
        if (err.message) return err.message;
        return 'Something went wrong. Please try again.';
    }

    function loadScript(src, attrs) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[src="' + src + '"]');
            if (existing) {
                if (existing.dataset.loaded === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', function () { resolve(); }, { once: true });
                existing.addEventListener('error', function () {
                    reject(new Error('Failed to load ' + src));
                }, { once: true });
                return;
            }

            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.crossOrigin = 'anonymous';
            if (attrs) {
                Object.keys(attrs).forEach(function (key) {
                    script.setAttribute(key, attrs[key]);
                });
            }
            script.onload = function () {
                script.dataset.loaded = '1';
                resolve();
            };
            script.onerror = function () {
                reject(new Error('Failed to load ' + src));
            };
            document.head.appendChild(script);
        });
    }

    async function activateSession(sessionId) {
        var clerk = getClerk();
        if (!clerk || !sessionId) {
            throw new Error('Could not activate session.');
        }
        // Do not pass redirectUrl — callers navigate after auth completes.
        await clerk.setActive({ session: sessionId });
        notify(getState());
    }

    async function initClerk() {
        var uiSrc = 'https://' + config.frontendApi + '/npm/@clerk/ui@1/dist/ui.browser.js';
        var clerkSrc = 'https://' + config.frontendApi + '/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

        await loadScript(uiSrc);
        await loadScript(clerkSrc, {
            'data-clerk-publishable-key': config.publishableKey,
        });

        if (!window.Clerk) {
            throw new Error('Clerk global was not created after loading clerk-js.');
        }

        if (typeof window.Clerk === 'function' && typeof window.Clerk.load !== 'function') {
            window.Clerk = new window.Clerk(config.publishableKey);
        }

        var loadOptions = {
            signInUrl: config.signInUrl,
            signUpUrl: config.signUpUrl,
            afterSignInUrl: config.afterSignInUrl,
            afterSignUpUrl: config.afterSignUpUrl,
            // Use fallback (not force) so incomplete OAuth sign-ups can continue
            // instead of being hard-redirected home without an active session.
            signInFallbackRedirectUrl: config.afterSignInUrl || '/',
            signUpFallbackRedirectUrl: config.afterSignUpUrl || '/',
            // Block open redirects via ?redirect_url= to unknown hosts.
            allowedRedirectOrigins: config.allowedRedirectOrigins || [
                'https://usertypo.com',
                'https://www.usertypo.com',
            ],
        };

        if (window.__internal_ClerkUICtor) {
            loadOptions.ui = { ClerkUI: window.__internal_ClerkUICtor };
        }

        if (window.Clerk && typeof window.Clerk.load === 'function') {
            await window.Clerk.load(loadOptions);
        } else {
            throw new Error('Could not find a callable Clerk.load() after script load.');
        }

        if (window.Clerk && typeof window.Clerk.addListener === 'function') {
            window.Clerk.addListener(function () {
                notify(getState());
            });
        }

        var state = getState();
        notify(state);
        console.info(
            '[usertypo auth] Clerk ready. Signed in:',
            state.isSignedIn,
            state.user ? '(user id: ' + state.user.id + ')' : ''
        );
        return state;
    }

    function markAuthWelcome(kind) {
        if (typeof window.usertypoSetAuthWelcome === 'function') {
            window.usertypoSetAuthWelcome(kind);
            return;
        }
        try {
            if (kind === 'new' || kind === 'back') {
                sessionStorage.setItem('usertypo_auth_welcome', kind);
                window.__usertypoPendingWelcome = kind;
            }
        } catch (e) { /* ignore */ }
    }

    function inferWelcomeKindFromUser(user) {
        try {
            if (!user || !user.createdAt) return 'back';
            var created = new Date(user.createdAt).getTime();
            if (!isFinite(created)) return 'back';
            if (Date.now() - created < 15 * 60 * 1000) return 'new';
        } catch (e) { /* ignore */ }
        return 'back';
    }

    async function signInWithPassword(identifier, password) {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk || !clerk.client) {
            throw new Error('Clerk is not ready yet.');
        }

        var signIn = await clerk.client.signIn.create({
            identifier: identifier,
            password: password,
        });

        if (signIn.status === 'complete') {
            await activateSession(signIn.createdSessionId);
            markAuthWelcome('back');
            return { status: 'complete' };
        }

        return {
            status: signIn.status,
            message: 'More verification is required for this account.',
        };
    }

    async function signUpWithPassword(fields) {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk || !clerk.client) {
            throw new Error('Clerk is not ready yet.');
        }

        var payload = {
            emailAddress: fields.email,
            password: fields.password,
        };
        if (fields.username) {
            payload.username = fields.username;
        }

        var signUp = await clerk.client.signUp.create(payload);
        pendingSignUp = signUp;

        if (signUp.status === 'complete') {
            await activateSession(signUp.createdSessionId);
            pendingSignUp = null;
            markAuthWelcome('new');
            return { status: 'complete' };
        }

        if (signUp.status === 'missing_requirements') {
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            return { status: 'needs_email_verification' };
        }

        return {
            status: signUp.status,
            message: 'Could not finish creating your account.',
        };
    }

    async function verifyEmailCode(code) {
        await readyPromise;
        if (!pendingSignUp) {
            throw new Error('No sign-up is waiting for verification.');
        }

        var result = await pendingSignUp.attemptEmailAddressVerification({ code: code });
        if (result.status === 'complete') {
            await activateSession(result.createdSessionId);
            pendingSignUp = null;
            markAuthWelcome('new');
            return { status: 'complete' };
        }

        return {
            status: result.status,
            message: 'Verification is not complete yet.',
        };
    }

    function sanitizeUsername(raw) {
        var base = String(raw || '')
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '')
            .replace(/_+/g, '_')
            .replace(/^_+/g, '')
            .slice(0, 20);
        while (base.length < 4) {
            base += String(Math.floor(Math.random() * 10));
        }
        return base.slice(0, 32);
    }

    function emailFromSignUp(signUp) {
        if (!signUp) return '';
        if (signUp.emailAddress) return String(signUp.emailAddress);
        var list = signUp.emailAddresses;
        if (Array.isArray(list) && list.length) {
            var first = list[0];
            if (typeof first === 'string') return first;
            if (first && first.emailAddress) return String(first.emailAddress);
        }
        return '';
    }

    function nameFromExternalAccount(account) {
        if (!account || typeof account !== 'object') return '';
        if (account.fullName) return String(account.fullName).trim();
        if (account.label) return String(account.label).trim();
        if (account.name) return String(account.name).trim();
        var parts = [account.firstName, account.lastName, account.givenName, account.familyName]
            .map(function (part) { return part ? String(part).trim() : ''; })
            .filter(Boolean);
        if (parts.length) return parts.join(' ');
        if (account.username) return String(account.username).trim();
        return '';
    }

    function googleNameFromSignUp(signUp) {
        if (!signUp) return '';
        if (signUp.fullName) return String(signUp.fullName).trim();
        var parts = [signUp.firstName, signUp.lastName]
            .map(function (part) { return part ? String(part).trim() : ''; })
            .filter(Boolean);
        if (parts.length) return parts.join(' ');

        // OAuth profile sometimes lands on externalAccount / verifications only.
        var fromExternal = nameFromExternalAccount(signUp.externalAccount);
        if (fromExternal) return fromExternal;

        var verificationAccount = signUp.verifications
            && signUp.verifications.externalAccount
            && signUp.verifications.externalAccount.externalVerificationRedirectURL == null
            ? signUp.verifications.externalAccount
            : null;
        fromExternal = nameFromExternalAccount(verificationAccount);
        if (fromExternal) return fromExternal;

        if (Array.isArray(signUp.externalAccounts)) {
            for (var i = 0; i < signUp.externalAccounts.length; i += 1) {
                fromExternal = nameFromExternalAccount(signUp.externalAccounts[i]);
                if (fromExternal) return fromExternal;
            }
        }

        return '';
    }

    function emailLocalPartSuggestion(signUp) {
        var email = emailFromSignUp(signUp);
        var local = email ? email.split('@')[0] : '';
        return local ? sanitizeUsername(local) : '';
    }

    /**
     * Auto username for Google OAuth: Google display name only.
     * Email local-part is form prefill when we must ask — never silent auto-complete.
     */
    function autoUsernameFromGoogle(signUp) {
        var fromName = googleNameFromSignUp(signUp);
        return fromName ? sanitizeUsername(fromName) : '';
    }

    function isUsernameTakenError(err) {
        var code = '';
        var param = '';
        var message = '';
        if (err && err.errors && err.errors[0]) {
            code = String(err.errors[0].code || '').toLowerCase();
            message = String(err.errors[0].longMessage || err.errors[0].message || '');
            if (err.errors[0].meta) {
                param = String(err.errors[0].meta.paramName || err.errors[0].meta.name || '').toLowerCase();
            }
        }
        if (param === 'email_address' || param === 'email') return false;
        if (code === 'form_username_exists') return true;
        if (code === 'form_identifier_exists' && param === 'username') return true;
        return /username.*(already|taken|exists)|already (been )?taken|is taken/i.test(message);
    }

    function isIdentifierExistsError(err) {
        var code = '';
        var message = '';
        var longMessage = '';
        var param = '';
        if (err && err.code) {
            code = String(err.code || '').toLowerCase();
        }
        if (err && err.errors && err.errors[0]) {
            code = code || String(err.errors[0].code || '').toLowerCase();
            message = String(err.errors[0].message || '');
            longMessage = String(err.errors[0].longMessage || '');
            if (err.errors[0].meta) {
                param = String(err.errors[0].meta.paramName || err.errors[0].meta.name || '').toLowerCase();
            }
        }
        if (err && err.message) {
            message = message || String(err.message);
        }
        if (param === 'username') return false;
        if (code === 'email_already_exists') return true;
        if (param === 'email_address' || param === 'email') {
            return code === 'form_identifier_exists' || code === 'identifier_exists';
        }
        var text = (message + ' ' + longMessage).toLowerCase();
        return (
            code === 'form_identifier_exists'
            || code === 'identifier_exists'
            || /email.*(already|taken|exists)|account with this email already exists/i.test(text)
        );
    }

    var EMAIL_EXISTS_MESSAGE =
        'An account with this email already exists. Sign in with the method you used originally.';

    function emailExistsError() {
        var err = new Error(EMAIL_EXISTS_MESSAGE);
        err.code = 'email_already_exists';
        return err;
    }

    /**
     * True when Clerk already has a user for this email (password and/or OAuth).
     * Used to block OAuth from creating a second account for the same Gmail.
     */
    async function accountExistsForEmail(email) {
        var clerk = getClerk();
        var normalized = String(email || '').trim().toLowerCase();
        if (!clerk || !clerk.client || !clerk.client.signIn || !normalized) {
            return { exists: false };
        }

        try {
            var signIn = await clerk.client.signIn.create({ identifier: normalized });
            var factors = signIn && signIn.supportedFirstFactors
                ? signIn.supportedFirstFactors
                : [];
            var hasPassword = factors.some(function (f) {
                return f && (f.strategy === 'password' || f.strategy === 'email_code');
            });
            var hasGoogle = factors.some(function (f) {
                return f && f.strategy === 'oauth_google';
            });
            // Any successful identifier lookup means an account already exists.
            if (
                signIn
                && (
                    signIn.status === 'needs_first_factor'
                    || signIn.status === 'needs_second_factor'
                    || signIn.status === 'complete'
                    || factors.length > 0
                )
            ) {
                return { exists: true, hasPassword: hasPassword, hasGoogle: hasGoogle };
            }
            return { exists: false };
        } catch (err) {
            var code = '';
            if (err && err.errors && err.errors[0]) {
                code = String(err.errors[0].code || '').toLowerCase();
            }
            if (
                code === 'form_identifier_not_found'
                || code === 'identifier_not_found'
                || /couldn't find|could not find|not found/i.test(formatError(err))
            ) {
                return { exists: false };
            }
            // Unknown error — do not block OAuth completion on a flaky check.
            return { exists: false, uncertain: true };
        }
    }

    /**
     * Before finishing a Google OAuth *sign-up*, refuse if that email is
     * already registered via password (or another method). Existing duplicate
     * accounts are left alone; this only stops new ones.
     */
    async function assertOAuthEmailAvailable(signUp, emailOverride) {
        var email = emailOverride || emailFromSignUp(signUp);
        if (!email) return;
        var existing = await accountExistsForEmail(email);
        if (existing.exists) {
            throw emailExistsError();
        }
    }

    /**
     * New Google users often land in missing_requirements (username / legal_accepted).
     * When Google provides a display name, set username from it and never prompt.
     * Only return needs_username when no Google name (and no explicit preferredUsername).
     */
    async function completePendingOAuthSignUp(preferredUsername) {
        var clerk = getClerk();
        var signUp = clerk && clerk.client && clerk.client.signUp;
        if (!signUp || !signUp.status) {
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'A',location:'clerk.js:completePendingOAuthSignUp',message:'no signUp object',data:{hasClerk:!!clerk,hasClient:!!(clerk&&clerk.client)},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            return { status: 'none' };
        }

        // Refresh OAuth profile fields before reading the Google display name.
        if (typeof signUp.reload === 'function') {
            try {
                signUp = await signUp.reload();
            } catch (e) { /* keep current snapshot */ }
        }

        // Snapshot identity fields before assertOAuthEmailAvailable — that helper
        // creates a SignIn lookup which can disturb client.signUp state.
        var googleName = googleNameFromSignUp(signUp);
        var emailSnapshot = emailFromSignUp(signUp);
        var firstNameSnapshot = signUp.firstName || '';
        var lastNameSnapshot = signUp.lastName || '';

        // #region agent log
        fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'A,B',location:'clerk.js:completePending:preAssert',message:'snapshot before email assert',data:{status:signUp.status,missing:signUp.missingFields||[],hasGoogleName:!!googleName,googleNameLen:(googleName||'').length,hasFirst:!!firstNameSnapshot,hasLast:!!lastNameSnapshot,hasEmail:!!emailSnapshot,hasPreferred:!!preferredUsername},timestamp:Date.now()})}).catch(function(){});
        // #endregion

        // Never create a second Clerk user for an email that already has an account.
        // Pass email snapshot so the SignIn lookup cannot depend on a wiped signUp.
        await assertOAuthEmailAvailable(signUp, emailSnapshot);

        signUp = clerk.client && clerk.client.signUp;
        if (!signUp || !signUp.status) {
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'B',location:'clerk.js:completePending:postAssert',message:'signUp missing after email assert',data:{hadGoogleNameSnapshot:!!googleName},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            return { status: 'none' };
        }
        if (typeof signUp.reload === 'function') {
            try {
                signUp = await signUp.reload();
            } catch (e) { /* keep current */ }
        }

        // Prefer live fields; fall back to pre-check snapshot if SignIn lookup cleared them.
        var googleNameAfter = googleNameFromSignUp(signUp);
        // #region agent log
        fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'B',location:'clerk.js:completePending:afterReload',message:'name fields after email assert/reload',data:{status:signUp.status,missing:signUp.missingFields||[],googleBeforeLen:(googleName||'').length,googleAfterLen:(googleNameAfter||'').length,nameWiped:!!(googleName&&!googleNameAfter)},timestamp:Date.now()})}).catch(function(){});
        // #endregion
        googleName = googleNameAfter || googleName;
        firstNameSnapshot = signUp.firstName || firstNameSnapshot;
        lastNameSnapshot = signUp.lastName || lastNameSnapshot;

        if (signUp.status === 'complete' && signUp.createdSessionId) {
            await activateSession(signUp.createdSessionId);
            markAuthWelcome('new');
            return { status: 'complete' };
        }

        if (signUp.status !== 'missing_requirements') {
            return {
                status: signUp.status,
                missingFields: signUp.missingFields || [],
                hasGoogleName: !!googleName,
            };
        }

        var hasGoogleName = !!googleName;
        var usernameSeed = preferredUsername
            ? sanitizeUsername(preferredUsername)
            : autoUsernameFromGoogle({
                fullName: googleName,
                firstName: firstNameSnapshot,
                lastName: lastNameSnapshot,
            }) || (googleName ? sanitizeUsername(googleName) : '');

        var attempts = 0;
        var maxAttempts = hasGoogleName || preferredUsername ? 12 : 1;

        while (attempts < maxAttempts) {
            var missing = signUp.missingFields || [];
            if (!missing.length) break;

            var updates = {};
            if (missing.indexOf('legal_accepted') !== -1) {
                updates.legalAccepted = true;
            }
            if (missing.indexOf('username') !== -1) {
                if (!usernameSeed) {
                    // No Google display name and no caller-supplied username — ask the user.
                    // #region agent log
                    fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'A,E',location:'clerk.js:needs_username:emptySeed',message:'returning needs_username empty seed',data:{missing:missing,hasGoogleName:hasGoogleName,seedLen:0,attempt:attempts},timestamp:Date.now()})}).catch(function(){});
                    // #endregion
                    return {
                        status: 'needs_username',
                        missingFields: missing,
                        suggestedUsername: emailLocalPartSuggestion(signUp) || emailLocalPartSuggestion({ emailAddress: emailSnapshot }),
                        hasGoogleName: false,
                    };
                }
                updates.username = attempts === 0
                    ? usernameSeed
                    : sanitizeUsername(usernameSeed.slice(0, 12) + Math.floor(Math.random() * 9000 + 1000));
            }
            if (missing.indexOf('first_name') !== -1) {
                updates.firstName = signUp.firstName || firstNameSnapshot || 'Player';
            }
            if (missing.indexOf('last_name') !== -1) {
                updates.lastName = signUp.lastName || lastNameSnapshot || 'User';
            }

            if (!Object.keys(updates).length) {
                // Unhandled missing fields — only prompt for username when that's what's left
                // and we have no Google name to apply.
                if (missing.indexOf('username') !== -1 && !usernameSeed) {
                    return {
                        status: 'needs_username',
                        missingFields: missing,
                        suggestedUsername: emailLocalPartSuggestion(signUp) || emailLocalPartSuggestion({ emailAddress: emailSnapshot }),
                        hasGoogleName: false,
                    };
                }
                return {
                    status: 'missing_requirements',
                    missingFields: missing,
                    suggestedUsername: usernameSeed,
                    hasGoogleName: hasGoogleName,
                };
            }

            try {
                signUp = await signUp.update(updates);
                if (signUp.status === 'complete' && signUp.createdSessionId) {
                    await activateSession(signUp.createdSessionId);
                    markAuthWelcome('new');
                    return { status: 'complete' };
                }
                attempts += 1;
            } catch (err) {
                if (updates.username && isUsernameTakenError(err)) {
                    attempts += 1;
                    continue;
                }
                if (isIdentifierExistsError(err)) {
                    throw emailExistsError();
                }
                throw err;
            }
        }

        if (signUp.status === 'complete' && signUp.createdSessionId) {
            await activateSession(signUp.createdSessionId);
            markAuthWelcome('new');
            return { status: 'complete' };
        }

        var stillMissing = signUp.missingFields || [];
        // With a Google name we should have set username — if username is still missing,
        // treat as needs_username only when we truly have nothing to derive from Google.
        if (stillMissing.indexOf('username') !== -1 && !usernameSeed) {
            return {
                status: 'needs_username',
                missingFields: stillMissing,
                suggestedUsername: emailLocalPartSuggestion(signUp) || emailLocalPartSuggestion({ emailAddress: emailSnapshot }),
                hasGoogleName: false,
            };
        }

        return {
            status: 'missing_requirements',
            missingFields: stillMissing,
            suggestedUsername: usernameSeed,
            hasGoogleName: hasGoogleName,
        };
    }

    async function startGoogleOAuth(mode) {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk || !clerk.client) {
            throw new Error('Clerk is not ready yet.');
        }

        var callbackUrl = window.location.origin + (config.ssoCallbackUrl || '/sso-callback');
        var completeUrl = window.location.origin + (
            mode === 'signup'
                ? (config.afterSignUpUrl || config.afterSignInUrl || '/')
                : (config.afterSignInUrl || '/')
        );

        var params = {
            strategy: 'oauth_google',
            redirectUrl: callbackUrl,
            redirectUrlComplete: completeUrl,
        };

        if (mode === 'signup' && clerk.client.signUp
            && typeof clerk.client.signUp.authenticateWithRedirect === 'function') {
            await clerk.client.signUp.authenticateWithRedirect(params);
            return;
        }

        if (clerk.client.signIn && typeof clerk.client.signIn.authenticateWithRedirect === 'function') {
            await clerk.client.signIn.authenticateWithRedirect(params);
            return;
        }

        if (clerk.client.signIn && typeof clerk.client.signIn.create === 'function') {
            var signIn = await clerk.client.signIn.create({});
            if (signIn && typeof signIn.authenticateWithRedirect === 'function') {
                await signIn.authenticateWithRedirect(params);
                return;
            }
        }

        throw new Error(
            'Google sign-in could not start. Enable Google in Clerk and set Paths to your app URLs.'
        );
    }

    async function signInWithGoogle() {
        return startGoogleOAuth('signin');
    }

    async function signUpWithGoogle() {
        return startGoogleOAuth('signup');
    }

    async function handleSsoCallback() {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk || typeof clerk.handleRedirectCallback !== 'function') {
            throw new Error('Clerk redirect handler is not available.');
        }

        var homePath = config.afterSignInUrl || '/';
        var continuePath = config.ssoCallbackUrl || '/sso-callback';
        var signInPath = config.signInUrl || '/signin';

        // Swallow Clerk's navigate callback — we decide where to go after the
        // pending OAuth sign-up is fully completed (username / legal, etc.).
        await clerk.handleRedirectCallback({
            signInUrl: window.location.origin + signInPath,
            signUpUrl: window.location.origin + (config.signUpUrl || '/signin'),
            afterSignInUrl: homePath,
            afterSignUpUrl: homePath,
            signInFallbackRedirectUrl: homePath,
            signUpFallbackRedirectUrl: homePath,
            continueSignUpUrl: continuePath,
            transferable: true,
        }, function () { /* handled below */ });

        notify(getState());
        if (getState().isSignedIn) {
            markAuthWelcome(inferWelcomeKindFromUser(getState().user));
            return { status: 'complete', redirectTo: homePath };
        }

        // Do not call assertOAuthEmailAvailable here — SignIn.create can wipe
        // pending SignUp profile fields (Google display name). Completion handles
        // the duplicate-email check after snapshotting the Google name.

        var finished;
        try {
            finished = await completePendingOAuthSignUp();
            // If Google name was available but completion raced, retry once with that seed.
            if (
                finished
                && finished.status === 'missing_requirements'
                && finished.hasGoogleName
                && finished.suggestedUsername
            ) {
                finished = await completePendingOAuthSignUp(finished.suggestedUsername);
            }
        } catch (err) {
            if (isIdentifierExistsError(err) || (err && err.code === 'email_already_exists')) {
                return {
                    status: 'email_exists',
                    message: EMAIL_EXISTS_MESSAGE,
                    redirectTo: signInPath,
                };
            }
            throw err;
        }
        notify(getState());

        // #region agent log
        fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'C,D,E',location:'clerk.js:handleSsoCallback:afterComplete',message:'finished completePendingOAuthSignUp',data:{finishedStatus:finished&&finished.status,hasGoogleName:!!(finished&&finished.hasGoogleName),missing:(finished&&finished.missingFields)||[],suggestedLen:((finished&&finished.suggestedUsername)||'').length,isSignedIn:!!getState().isSignedIn},timestamp:Date.now()})}).catch(function(){});
        // #endregion

        if (finished.status === 'complete' || getState().isSignedIn) {
            markAuthWelcome(
                finished.status === 'complete' ? 'new' : inferWelcomeKindFromUser(getState().user)
            );
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'D',location:'clerk.js:handleSsoCallback:returnComplete',message:'returning complete',data:{viaFinished:finished.status==='complete',viaSignedIn:!!getState().isSignedIn},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            return { status: 'complete', redirectTo: homePath };
        }

        // Only prompt when username is still required AND we could not derive a Google name.
        var missing = finished.missingFields || [];
        if (
            (finished.status === 'needs_username' || finished.status === 'missing_requirements')
            && missing.indexOf('username') !== -1
            && !finished.hasGoogleName
        ) {
            // #region agent log
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b090ba'},body:JSON.stringify({sessionId:'b090ba',runId:'pre-fix',hypothesisId:'A,E',location:'clerk.js:handleSsoCallback:returnNeedsUsername',message:'returning needs_username to UI',data:{finishedStatus:finished.status,missing:missing,suggestedLen:(finished.suggestedUsername||'').length},timestamp:Date.now()})}).catch(function(){});
            // #endregion
            return {
                status: 'needs_username',
                missingFields: missing,
                suggestedUsername: finished.suggestedUsername || '',
            };
        }

        // Last resort: Google name exists but signup still incomplete — try finishing
        // silently with the suggested username instead of flashing the form.
        if (
            finished.hasGoogleName
            && finished.suggestedUsername
            && missing.indexOf('username') !== -1
        ) {
            try {
                var retry = await completePendingOAuthSignUp(finished.suggestedUsername);
                notify(getState());
                if (retry.status === 'complete' || getState().isSignedIn) {
                    markAuthWelcome('new');
                    return { status: 'complete', redirectTo: homePath };
                }
            } catch (err) {
                if (isIdentifierExistsError(err) || (err && err.code === 'email_already_exists')) {
                    return {
                        status: 'email_exists',
                        message: EMAIL_EXISTS_MESSAGE,
                        redirectTo: signInPath,
                    };
                }
            }
        }

        throw new Error('Google sign-in did not complete. Please try again from the sign-in page.');
    }

    async function finishOAuthUsername(username) {
        await readyPromise;
        var name = sanitizeUsername(username);
        if (name.length < 4) {
            throw new Error('Username must be at least 4 characters.');
        }
        var finished = await completePendingOAuthSignUp(name);
        notify(getState());
        if (finished.status === 'complete' || getState().isSignedIn) {
            markAuthWelcome('new');
            return { status: 'complete', redirectTo: config.afterSignInUrl || '/' };
        }
        throw new Error('Could not finish creating your account. Try a different username.');
    }

    async function signOut() {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk) return;
        await clerk.signOut();
        notify(getState());
    }

    function isReverificationError(err) {
        if (!err) return false;
        var code = '';
        var longMessage = '';
        if (err.errors && err.errors.length) {
            code = String(err.errors[0].code || '');
            longMessage = String(err.errors[0].longMessage || err.errors[0].message || '');
        }
        var message = String(err.message || '');
        return (
            code === 'session_reverification_required'
            || code === 'reverification_required'
            || /reverification/i.test(code)
            || /additional verification/i.test(message)
            || /additional verification/i.test(longMessage)
        );
    }

    /**
     * Clerk requires recent credential proof for sensitive actions
     * (username change, email/password, account delete).
     * Opens Clerk's verification modal when the current session is stale.
     * Google-only accounts can re-verify with Google (password not required).
     * @param {'first_factor'|'second_factor'|'multi_factor'} [level]
     */
    async function ensureReverified(level) {
        await readyPromise;
        var clerk = getClerk();
        var session = clerk && clerk.session;
        if (!clerk || !session) {
            throw new Error('guest');
        }

        var verificationLevel = level || 'first_factor';
        var authCheck = {
            reverification: (verificationLevel === 'second_factor' || verificationLevel === 'multi_factor')
                ? 'strict_mfa'
                : 'strict',
        };

        if (typeof session.checkAuthorization === 'function') {
            try {
                if (session.checkAuthorization(authCheck)) {
                    return true;
                }
            } catch (e) { /* fall through to modal */ }
        }

        var ages = session.factorVerificationAge;
        if (
            Array.isArray(ages)
            && typeof ages[0] === 'number'
            && ages[0] >= 0
            && ages[0] < 10
            && verificationLevel === 'first_factor'
        ) {
            return true;
        }

        var openModal = null;
        if (typeof clerk.__internal_openReverification === 'function') {
            openModal = clerk.__internal_openReverification.bind(clerk);
        } else if (typeof clerk.__experimental_openUserVerification === 'function') {
            openModal = clerk.__experimental_openUserVerification.bind(clerk);
        } else if (clerk.session && typeof clerk.session.startVerification === 'function') {
            // Fallback for newer Clerk builds that expose session.startVerification.
            openModal = function (opts) {
                return clerk.session.startVerification({
                    level: opts && opts.level,
                }).then(function () {
                    if (opts && typeof opts.afterVerification === 'function') opts.afterVerification();
                }, function () {
                    if (opts && typeof opts.afterVerificationCancelled === 'function') {
                        opts.afterVerificationCancelled();
                    }
                });
            };
        }

        if (!openModal) {
            throw new Error('session_reverification_required');
        }

        return new Promise(function (resolve, reject) {
            var settled = false;
            var result = openModal({
                level: verificationLevel,
                afterVerification: function () {
                    if (settled) return;
                    settled = true;
                    notify(getState());
                    resolve(true);
                },
                afterVerificationCancelled: function () {
                    if (settled) return;
                    settled = true;
                    reject(new Error('verification_cancelled'));
                },
            });
            // Some Clerk builds return a Promise instead of using callbacks.
            if (result && typeof result.then === 'function') {
                result.then(function () {
                    if (settled) return;
                    settled = true;
                    notify(getState());
                    resolve(true);
                }, function () {
                    if (settled) return;
                    settled = true;
                    reject(new Error('verification_cancelled'));
                });
            }
        });
    }

    readyPromise = initClerk().catch(function (err) {
        // Avoid console.error noise in Lighthouse Best Practices; failure is still thrown to callers.
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[usertypo auth] Failed to start Clerk:', err && err.message ? err.message : err);
        }
        throw err;
    });

    window.usertypoAuth = {
        ready: function () {
            return readyPromise;
        },
        getState: getState,
        onChange: function (fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.push(fn);
            var state = getState();
            if (state.isLoaded) {
                try { fn(state); } catch (e) { /* ignore */ }
            }
            return function unsubscribe() {
                listeners = listeners.filter(function (x) { return x !== fn; });
            };
        },
        formatError: formatError,
        isReverificationError: isReverificationError,
        ensureReverified: ensureReverified,
        signInWithPassword: signInWithPassword,
        signUpWithPassword: signUpWithPassword,
        verifyEmailCode: verifyEmailCode,
        signInWithGoogle: signInWithGoogle,
        signUpWithGoogle: signUpWithGoogle,
        handleSsoCallback: handleSsoCallback,
        finishOAuthUsername: finishOAuthUsername,
        signOut: signOut,
    };
})();
