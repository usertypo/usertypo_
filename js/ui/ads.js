/**
 * Monetag loader — loads whenever ads.monetag is enabled in config.
 * Public: window.usertypoAds
 *
 * Visible "Sponsored / YOUR AD HERE" placeholders stay on the page until
 * Monetag is enabled with a zone ID for that slot. Ads are not user-toggleable.
 */
(function () {
    var loaded = false;

    var SLOT_ELEMENT_IDS = {
        home_results: 'ad-slot-home-results',
        leaderboards: 'ad-slot-leaderboards',
        room: 'ad-slot-room',
        dual: 'ad-slot-dual',
    };

    function getMonetagConfig() {
        var ads = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.ads) || {};
        var m = ads.monetag || {};
        var rawSlots = m.slots && typeof m.slots === 'object' ? m.slots : {};
        var slots = {};
        Object.keys(SLOT_ELEMENT_IDS).forEach(function (key) {
            slots[key] = String(rawSlots[key] || '').trim();
        });
        return {
            enabled: !!m.enabled,
            scriptSrc: String(m.scriptSrc || '').trim(),
            zoneId: String(m.zoneId || '').trim(),
            sdk: String(m.sdk || '').trim(),
            slots: slots,
        };
    }

    function loadMonetag(cfg) {
        if (loaded) return;
        if (!cfg.enabled || !cfg.scriptSrc) return;
        loaded = true;

        var script = document.createElement('script');
        script.async = true;
        script.src = cfg.scriptSrc;
        if (cfg.zoneId) script.setAttribute('data-zone', cfg.zoneId);
        if (cfg.sdk) script.setAttribute('data-sdk', cfg.sdk);
        document.head.appendChild(script);
    }

    function fillSlots(cfg) {
        Object.keys(SLOT_ELEMENT_IDS).forEach(function (key) {
            var el = document.getElementById(SLOT_ELEMENT_IDS[key]);
            if (!el) return;

            var zone = cfg.slots[key] || '';
            // Keep the visual placeholder as-is until ads are live for this slot.
            if (!cfg.enabled || !zone) {
                el.removeAttribute('data-zone');
                el.removeAttribute('data-ad-ready');
                return;
            }

            el.setAttribute('data-zone', zone);
            el.setAttribute('data-ad-ready', '1');
        });
    }

    function init() {
        var cfg = getMonetagConfig();
        fillSlots(cfg);
        loadMonetag(cfg);
    }

    function refresh() {
        init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.addEventListener('usertypo:page-ready', refresh);
    window.addEventListener('popstate', function () {
        setTimeout(refresh, 0);
    });

    window.usertypoAds = {
        isLoaded: function () { return loaded; },
        refresh: refresh,
    };
})();
