/**
 * Public community aggregates for the About page.
 * Prefers Cloudflare site-stats Worker (guest + signed-in merge); falls back to Supabase RPC.
 * Public API: window.usertypoSiteStats
 */
(function () {
    var cache = null;
    var cacheAt = 0;
    var CACHE_MS = 60 * 1000;
    var inFlight = null;

    function siteStatsUrl() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.siteStats) || {};
        return String(cfg.url || '').replace(/\/+$/, '');
    }

    async function getPublicStatsFromWorker(baseUrl) {
        var res = await fetch(baseUrl + '/public', {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('site_stats_worker_' + res.status);
        return res.json();
    }

    async function getPublicStatsFromSupabase() {
        if (!window.usertypoDb || typeof window.usertypoDb.getClient !== 'function') {
            throw new Error('usertypoDb is not loaded');
        }
        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('get_public_site_stats');
        if (result.error) throw result.error;
        return result.data || null;
    }

    async function getPublicStats(options) {
        var force = !!(options && options.force);
        var now = Date.now();
        if (!force && cache && now - cacheAt < CACHE_MS) {
            return cache;
        }
        if (!force && inFlight) return inFlight;

        inFlight = (async function () {
            var workerUrl = siteStatsUrl();
            var data = null;
            if (workerUrl) {
                try {
                    data = await getPublicStatsFromWorker(workerUrl);
                } catch (err) {
                    console.warn('[usertypo site-stats] worker failed, using supabase', err);
                }
            }
            if (!data) data = await getPublicStatsFromSupabase();
            cache = data || null;
            cacheAt = Date.now();
            return cache;
        })();

        try {
            return await inFlight;
        } finally {
            inFlight = null;
        }
    }

    /**
     * Record a completed guest test into Cloudflare aggregates (About page).
     * No-op when the Worker URL is not configured or the test failed.
     */
    async function ingestGuestTest(input) {
        var workerUrl = siteStatsUrl();
        if (!workerUrl) return { skipped: true, reason: 'not_configured' };
        if (!input || input.failed) return { skipped: true, reason: 'failed' };

        var duration = Math.max(0, Math.round(Number(input.duration_seconds) || 0));
        var words = Math.max(0, Math.round(Number(input.words) || 0));
        if (duration < 1 && words < 1) return { skipped: true, reason: 'empty' };

        try {
            var res = await fetch(workerUrl + '/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    duration_seconds: duration,
                    words: words,
                    wpm: input.wpm == null ? null : Number(input.wpm),
                    mode: input.mode || null,
                    amount: input.amount == null ? null : Number(input.amount),
                    failed: false,
                }),
            });
            var data = null;
            try { data = await res.json(); } catch (_) { data = null; }
            if (!res.ok) {
                return { skipped: true, reason: 'ingest_failed', status: res.status, data: data };
            }
            return data || { ok: true };
        } catch (err) {
            console.warn('[usertypo site-stats] guest ingest failed', err);
            return { skipped: true, reason: 'ingest_error' };
        }
    }

    window.usertypoSiteStats = {
        getPublicStats: getPublicStats,
        ingestGuestTest: ingestGuestTest,
        clearCache: function () {
            cache = null;
            cacheAt = 0;
        },
    };
})();
