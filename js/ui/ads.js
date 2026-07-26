/**
 * Monetag loader — loads whenever ads.monetag is enabled in config.
 * Public: window.usertypoAds
 *
 * Fill USERTYPO_CONFIG.ads.monetag in js/config/public.js with your zone snippet.
 */
(function () {
    var loaded = false;

    function getMonetagConfig() {
        var ads = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.ads) || {};
        var m = ads.monetag || {};
        return {
            enabled: !!m.enabled,
            scriptSrc: String(m.scriptSrc || '').trim(),
            zoneId: String(m.zoneId || '').trim(),
            sdk: String(m.sdk || '').trim(),
        };
    }

    function loadMonetag() {
        if (loaded) return;
        var cfg = getMonetagConfig();
        if (!cfg.enabled || !cfg.scriptSrc) return;
        loaded = true;

        var script = document.createElement('script');
        script.async = true;
        script.src = cfg.scriptSrc;
        if (cfg.zoneId) script.setAttribute('data-zone', cfg.zoneId);
        if (cfg.sdk) script.setAttribute('data-sdk', cfg.sdk);
        document.head.appendChild(script);
    }

    function init() {
        loadMonetag();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.usertypoAds = {
        isLoaded: function () { return loaded; },
    };
})();
