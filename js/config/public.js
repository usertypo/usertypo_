/**
 * Public client config for usertypo_
 *
 * Only PUBLISHABLE / ANON values belong here (safe in the browser).
 * Never put Secret keys (sk_...) or service-role keys in this file.
 *
 * Local override: set CLERK_PUBLISHABLE_KEY in `.env` and run `npm run dev`
 * (server injects them). For static hosts, set these values at deploy/build time.
 *
 * Architecture:
 * - Website: https://usertypo.com (Cloudflare Pages)
 * - Backend (Socket.IO, /api/*): https://mp.usertypo.com (Render)
 * - Local `npm run dev`: blank backend URLs → same-origin Express
 */
window.USERTYPO_CONFIG = {
    clerk: {
        publishableKey: 'pk_test_dHJ1c3RlZC1wcmF3bi0zMS5jbGVyay5hY2NvdW50cy5kZXYk',
        frontendApi: 'trusted-prawn-31.clerk.accounts.dev',
        signInUrl: '/signin',
        signUpUrl: '/signin',
        afterSignInUrl: '/',
        afterSignUpUrl: '/',
        ssoCallbackUrl: '/sso-callback',
    },
    supabase: {
        url: 'https://skebosepedaxnvcaizka.supabase.co',
        // Prefer new publishable key; anon kept as fallback for older clients
        publishableKey: 'sb_publishable_NvfpUKNOtSQ8KuIP1H-JkA_ZriwgB72',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrZWJvc2VwZWRheG52Y2FpemthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjc5MDEsImV4cCI6MjA5OTYwMzkwMX0.OhFRFJQfzlL3DJJXtv-lKWZYDWnrkJ5cQhu3dwduDFI',
    },
    // Render backend host (no trailing slash). Blank on localhost.
    backend: {
        url: 'https://mp.usertypo.com',
    },
    multiplayer: {
        // Socket.IO server. Usually same as backend.url. Blank on localhost.
        url: 'https://mp.usertypo.com',
    },
    analytics: {
        // GA4 Measurement ID, e.g. 'G-XXXXXXXX'. Empty = do not load analytics.
        ga4MeasurementId: '',
    },
    ads: {
        monetag: {
            // Set enabled: true and paste your Monetag zone script details when ready.
            enabled: false,
            scriptSrc: '',
            zoneId: '',
            sdk: '',
        },
    },
};

(function normalizeLocalBackendUrls() {
    var cfg = window.USERTYPO_CONFIG;
    if (!cfg) return;
    var host = '';
    try { host = String(location.hostname || ''); } catch (_) { host = ''; }
    if (host === 'localhost' || host === '127.0.0.1') {
        if (cfg.backend) cfg.backend.url = '';
        if (cfg.multiplayer) cfg.multiplayer.url = '';
    }
})();
