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
 * - Dev site: https://dev.usertypo.com (Pages `dev` branch → separate Supabase + CF workers)
 * - Multiplayer: Cloudflare Workers + Durable Objects
 * - Leaderboards: Cloudflare Worker + Supabase Postgres
 * - Local `npm run dev`: same public URLs, or MULTIPLAYER_SERVER_URL / LEADERBOARDS_WORKER_URL in `.env`
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
            'http://localhost:3000',
            'http://127.0.0.1:3000',
        ],
    },
    supabase: {
        url: 'https://skebosepedaxnvcaizka.supabase.co',
        // Prefer new publishable key; anon kept as fallback for older clients
        publishableKey: 'sb_publishable_NvfpUKNOtSQ8KuIP1H-JkA_ZriwgB72',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrZWJvc2VwZWRheG52Y2FpemthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjc5MDEsImV4cCI6MjA5OTYwMzkwMX0.OhFRFJQfzlL3DJJXtv-lKWZYDWnrkJ5cQhu3dwduDFI',
    },
    multiplayer: {
        url: 'https://usertypo-mp.usertypo2026.workers.dev',
        transport: 'cf',
    },
    leaderboards: {
        url: 'https://usertypo-leaderboards.usertypo2026.workers.dev',
    },
    // Site stats Worker (guest aggregates + About page merge). Staging only until prod cutover.
    siteStats: {
        url: '',
    },
    features: {
        leaderboards: true,
    },
    analytics: {
        // GA4 Measurement ID, e.g. 'G-XXXXXXXX'. Empty = do not load analytics.
        ga4MeasurementId: 'G-J3Z3XM22WQ',
    },
    ads: {
        // Ezoic Incubator / JS connection (sa.min.js loaded from index.html).
        // AdSense is managed by Ezoic; no separate AdSense script needed.
        ezoicEnabled: true,
        ezoicAdsTxtUrl: 'https://srv.adstxtmanager.com/19390/usertypo.com',
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
            'http://127.0.0.1:3000',
        ];
        cfg.supabase = {
            url: 'https://dzpbkyqsshdruwhffwhw.supabase.co',
            publishableKey: 'sb_publishable_nnRcpE_zT8Vtv0Z4MNTBKw_TqJhGC10',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6cGJreXFzc2hkcnV3aGZmd2h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Nzg5NDMsImV4cCI6MjEwMzU1NDk0M30.xeBQz3lc7FukiptPcEl4cDsBD16aCatYytk7vWsWmEM',
        };
        cfg.multiplayer = {
            url: 'https://usertypo-mp-dev.usertypo2026.workers.dev',
            transport: 'cf',
        };
        cfg.leaderboards = {
            url: 'https://usertypo-leaderboards-dev.usertypo2026.workers.dev',
        };
        cfg.siteStats = {
            url: 'https://usertypo-site-stats-dev.usertypo2026.workers.dev',
        };
        if (!cfg.features) cfg.features = {};
        cfg.features.leaderboards = true;
        if (cfg.analytics) cfg.analytics.ga4MeasurementId = '';
        if (cfg.ads) {
            cfg.ads.ezoicEnabled = false;
        }
        cfg.environment = 'staging';
    }

    if (isStagingHost(host)) {
        applyStagingConfig();
        console.info('[usertypo] staging environment:', host, '→ Clerk Development + usertypo-dev Supabase + CF workers');
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
