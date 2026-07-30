/**
 * Public community aggregates for the About page.
 * Public API: window.usertypoSiteStats
 */
(function () {
    var cache = null;
    var cacheAt = 0;
    var CACHE_MS = 60 * 1000;
    var inFlight = null;

    async function getPublicStats(options) {
        var force = !!(options && options.force);
        var now = Date.now();
        if (!force && cache && now - cacheAt < CACHE_MS) {
            return cache;
        }
        if (!force && inFlight) return inFlight;

        inFlight = (async function () {
            if (!window.usertypoDb || typeof window.usertypoDb.getClient !== 'function') {
                throw new Error('usertypoDb is not loaded');
            }
            var client = await window.usertypoDb.getClient();
            var result = await client.rpc('get_public_site_stats');
            if (result.error) throw result.error;
            cache = result.data || null;
            cacheAt = Date.now();
            return cache;
        })();

        try {
            return await inFlight;
        } finally {
            inFlight = null;
        }
    }

    window.usertypoSiteStats = {
        getPublicStats: getPublicStats,
        clearCache: function () {
            cache = null;
            cacheAt = 0;
        },
    };
})();
