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
 * - Dev site: https://dev.usertypo.com (Pages `dev` branch → separate Supabase + Render)
 * - Backend (Socket.IO, /api/*): https://mp.usertypo.com (Render)
 * - Local `npm run dev`: blank backend URLs → same-origin Express
 */
window.USERTYPO_CONFIG = {
    clerk: {
        publishableKey: 'pk_live_Y2xlcmsudXNlcnR5cG8uY29tJA',
        frontendApi: 'clerk.usertypo.com',
        signInUrl: '/signin',
        signUpUrl: '/signin',
        afterSignInUrl: '/',
        afterSignUpUrl: '/',
        ssoCallbackUrl: '/sso-callback',
        // Used by Clerk.load({ allowedRedirectOrigins })
        allowedRedirectOrigins: [
            'https://usertypo.com',
            'https://www.usertypo.com',
            'https://dev.usertypo.com',
        ],
    },
    supabase: {
        url: 'https://skebosepedaxnvcaizka.supabase.co',
        // Prefer new publishable key; anon kept as fallback for older clients
        publishableKey: 'sb_publishable_NvfpUKNOtSQ8KuIP1H-JkA_ZriwgB72',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrZWJvc2VwZWRheG52Y2FpemthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjc5MDEsImV4cCI6MjA5OTYwMzkwMX0.OhFRFJQfzlL3DJJXtv-lKWZYDWnrkJ5cQhu3dwduDFI',
    },
    // Render backend host (no trailing slash). Blank on localhost / onrender.com.
    backend: {
        url: 'https://mp.usertypo.com',
    },
    multiplayer: {
        // Socket.IO server. Usually same as backend.url. Blank on localhost.
        url: 'https://mp.usertypo.com',
    },
    // Cloudflare Leaderboards Worker (Postgres — no Upstash).
    leaderboards: {
        url: 'https://usertypo-leaderboards.usertypo2026.workers.dev',
    },
    features: {
        leaderboards: true,
    },
    analytics: {
        // GA4 Measurement ID, e.g. 'G-XXXXXXXX'. Empty = do not load analytics.
        ga4MeasurementId: 'G-J3Z3XM22WQ',
    },
    ads: {
        // Google AdSense publisher client. Ad units wired after approval.
        adsenseClient: 'ca-pub-4215657077722335',
    },
};

(function applyHostEnvironment() {
    var cfg = window.USERTYPO_CONFIG;
    if (!cfg) return;
    var host = '';
    try { host = String(location.hostname || '').toLowerCase(); } catch (_) { host = ''; }

    function isStagingHost(h) {
        return h === 'dev.usertypo.com'
            || h === 'www.dev.usertypo.com'
            || h === 'dev.usertypo.pages.dev';
    }

    function applyStagingConfig() {
        if (!cfg.clerk) cfg.clerk = {};
        cfg.clerk.publishableKey = 'pk_test_dHJ1c3RlZC1wcmF3bi0zMS5jbGVyay5hY2NvdW50cy5kZXYk';
        cfg.clerk.frontendApi = 'trusted-prawn-31.clerk.accounts.dev';
        cfg.clerk.allowedRedirectOrigins = [
            'https://dev.usertypo.com',
            'https://dev.usertypo.pages.dev',
            'http://localhost:3000',
        ];
        cfg.supabase = {
            url: 'https://dzpbkyqsshdruwhffwhw.supabase.co',
            publishableKey: 'sb_publishable_nnRcpE_zT8Vtv0Z4MNTBKw_TqJhGC10',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6cGJreXFzc2hkcnV3aGZmd2h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Nzg5NDMsImV4cCI6MjEwMzU1NDk0M30.xeBQz3lc7FukiptPcEl4cDsBD16aCatYytk7vWsWmEM',
        };
        cfg.backend = { url: 'https://usertypo-dev.onrender.com' };
        cfg.multiplayer = { url: 'https://usertypo-dev.onrender.com' };
        cfg.leaderboards = {
            url: 'https://usertypo-leaderboards-dev.usertypo2026.workers.dev',
        };
        if (!cfg.features) cfg.features = {};
        cfg.features.leaderboards = true;
        if (cfg.analytics) cfg.analytics.ga4MeasurementId = '';
        if (cfg.ads) cfg.ads.adsenseClient = '';
        cfg.environment = 'staging';
    }

    // Staging: Clerk Development + dev Supabase + Cloudflare leaderboards Worker.
    if (isStagingHost(host)) {
        applyStagingConfig();
        console.info('[usertypo] staging environment:', host, '→ Clerk Development + usertypo-dev Supabase + CF leaderboards');
    }

    // Same-origin hosts: leave blank so Socket.IO uses this page's origin.
    if (
        host === 'localhost'
        || host === '127.0.0.1'
        || host === 'usertypo.onrender.com'
        || host === 'usertypo-dev.onrender.com'
    ) {
        if (cfg.backend) cfg.backend.url = '';
        if (cfg.multiplayer) cfg.multiplayer.url = '';
    }

    function syncLeaderboardsNavVisibility() {
        var el = document.getElementById('nav-leaderboards');
        if (!el) return;
        var enabled = !(cfg.features && cfg.features.leaderboards === false);
        if (enabled) {
            el.hidden = false;
            el.removeAttribute('aria-hidden');
            el.style.display = '';
        } else {
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
            el.style.display = 'none';
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncLeaderboardsNavVisibility);
    } else {
        syncLeaderboardsNavVisibility();
    }
})();
