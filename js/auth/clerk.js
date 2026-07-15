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
        await clerk.setActive({
            session: sessionId,
            redirectUrl: config.afterSignInUrl || '/',
        });
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
            signInForceRedirectUrl: config.afterSignInUrl || '/',
            signUpForceRedirectUrl: config.afterSignUpUrl || '/',
            signInFallbackRedirectUrl: config.afterSignInUrl || '/',
            signUpFallbackRedirectUrl: config.afterSignUpUrl || '/',
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
            return { status: 'complete' };
        }

        return {
            status: result.status,
            message: 'Verification is not complete yet.',
        };
    }

    async function signInWithGoogle() {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk || !clerk.client || !clerk.client.signIn) {
            throw new Error('Clerk is not ready yet.');
        }

        var callbackUrl = window.location.origin + (config.ssoCallbackUrl || '/sso-callback');
        var completeUrl = window.location.origin + (config.afterSignInUrl || '/');

        if (typeof clerk.client.signIn.authenticateWithRedirect === 'function') {
            await clerk.client.signIn.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: callbackUrl,
                redirectUrlComplete: completeUrl,
            });
            return;
        }

        if (typeof clerk.client.signIn.create === 'function') {
            var signIn = await clerk.client.signIn.create({});
            if (signIn && typeof signIn.authenticateWithRedirect === 'function') {
                await signIn.authenticateWithRedirect({
                    strategy: 'oauth_google',
                    redirectUrl: callbackUrl,
                    redirectUrlComplete: completeUrl,
                });
                return;
            }
        }

        throw new Error(
            'Google sign-in could not start. Enable Google in Clerk and set Paths to your app URLs.'
        );
    }

    async function handleSsoCallback() {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk || typeof clerk.handleRedirectCallback !== 'function') {
            throw new Error('Clerk redirect handler is not available.');
        }

        var home = window.location.origin + (config.afterSignInUrl || '/');
        await clerk.handleRedirectCallback({
            signInUrl: window.location.origin + (config.signInUrl || '/signin'),
            signUpUrl: window.location.origin + (config.signUpUrl || '/signin'),
            afterSignInUrl: home,
            afterSignUpUrl: home,
            signInForceRedirectUrl: home,
            signUpForceRedirectUrl: home,
            continueSignUpUrl: window.location.origin + (config.signInUrl || '/signin'),
        }, function (to) {
            var path = to;
            try {
                if (String(to).indexOf('http') === 0) {
                    var u = new URL(to);
                    if (u.origin === window.location.origin) {
                        path = u.pathname + u.search + u.hash;
                    } else {
                        window.location.href = to;
                        return;
                    }
                }
            } catch (e) { /* use as-is */ }

            if (window.navigateTo) {
                window.navigateTo(path || '/');
            } else {
                window.location.href = path || '/';
            }
        });
        notify(getState());
    }

    async function signOut() {
        await readyPromise;
        var clerk = getClerk();
        if (!clerk) return;
        await clerk.signOut();
        notify(getState());
    }

    readyPromise = initClerk().catch(function (err) {
        console.error('[usertypo auth] Failed to start Clerk:', err);
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
        signInWithPassword: signInWithPassword,
        signUpWithPassword: signUpWithPassword,
        verifyEmailCode: verifyEmailCode,
        signInWithGoogle: signInWithGoogle,
        handleSsoCallback: handleSsoCallback,
        signOut: signOut,
    };
})();
