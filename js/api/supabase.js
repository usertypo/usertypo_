/**
 * Supabase browser client (Clerk session token as Authorization Bearer).
 * Public API: window.usertypoDb
 */
(function () {
    var clientPromise = null;
    var cachedClient = null;

    function getConfig() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.supabase) || {};
        return {
            url: cfg.url || '',
            // Legacy anon JWT is the safest apikey for REST until publishable keys are fully universal
            key: cfg.anonKey || cfg.publishableKey || '',
        };
    }

    function decodeJwtPayload(token) {
        try {
            var part = String(token).split('.')[1];
            if (!part) return null;
            var json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function loadSupabaseSdk() {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            return Promise.resolve(window.supabase);
        }

        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-usertypo-supabase-sdk="1"]');
            if (existing) {
                existing.addEventListener('load', function () {
                    if (window.supabase) resolve(window.supabase);
                    else reject(new Error('Supabase SDK loaded but global missing'));
                }, { once: true });
                existing.addEventListener('error', function () {
                    reject(new Error('Failed to load Supabase SDK'));
                }, { once: true });
                return;
            }

            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js';
            script.async = true;
            script.dataset.usertypoSupabaseSdk = '1';
            script.onload = function () {
                if (window.supabase && typeof window.supabase.createClient === 'function') {
                    resolve(window.supabase);
                } else {
                    reject(new Error('Supabase SDK global not found after load'));
                }
            };
            script.onerror = function () {
                reject(new Error('Failed to load Supabase SDK from CDN'));
            };
            document.head.appendChild(script);
        });
    }

    async function getClerkToken() {
        if (!window.Clerk || !window.Clerk.session) return null;
        // Native Clerk ↔ Supabase third-party auth uses the session JWT.
        // Clerk's Supabase integration should add role: "authenticated".
        return window.Clerk.session.getToken();
    }

    async function debugAuth() {
        var token = await getClerkToken();
        if (!token) {
            console.warn('[usertypo db] No Clerk session token available');
            return null;
        }
        var claims = decodeJwtPayload(token);
        console.info('[usertypo db] Clerk JWT claims', {
            role: claims && claims.role,
            sub: claims && claims.sub,
            iss: claims && claims.iss,
            hasAuthenticatedRole: !!(claims && claims.role === 'authenticated'),
        });
        if (!claims || claims.role !== 'authenticated') {
            console.warn(
                '[usertypo db] Missing role:"authenticated". Activate Clerk → Supabase integration, then sign out and sign back in.'
            );
        }
        return claims;
    }

    async function getClient() {
        if (cachedClient) return cachedClient;
        if (clientPromise) return clientPromise;

        clientPromise = (async function () {
            var cfg = getConfig();
            if (!cfg.url || !cfg.key) {
                throw new Error('Missing USERTYPO_CONFIG.supabase url/key');
            }

            var sdk = await loadSupabaseSdk();

            // Explicitly attach Clerk JWT on every request (more reliable than
            // depending on accessToken support in the UMD build).
            cachedClient = sdk.createClient(cfg.url, cfg.key, {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false,
                },
                accessToken: async function () {
                    return (await getClerkToken()) || null;
                },
                global: {
                    fetch: async function (url, options) {
                        var opts = options ? Object.assign({}, options) : {};
                        var headers = new Headers(opts.headers || {});
                        var token = await getClerkToken();
                        if (token) {
                            headers.set('Authorization', 'Bearer ' + token);
                        }
                        if (!headers.has('apikey')) {
                            headers.set('apikey', cfg.key);
                        }
                        opts.headers = headers;
                        return fetch(url, opts);
                    },
                },
            });
            return cachedClient;
        })();

        try {
            return await clientPromise;
        } catch (err) {
            clientPromise = null;
            throw err;
        }
    }

    window.usertypoDb = {
        getClient: getClient,
        getClerkToken: getClerkToken,
        debugAuth: debugAuth,
    };
})();
