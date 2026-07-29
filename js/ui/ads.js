/**
 * Monetag loader — loads whenever ads.monetag is enabled in config.
 * Public: window.usertypoAds
 *
 * Fill USERTYPO_CONFIG.ads.monetag in js/config/public.js with your zone snippet.
 * Slot containers stay hidden/empty until a non-empty zone ID is set for that slot.
 */
(function () {
    var loaded = false;

    var SLOT_ELEMENT_IDS = {
        home_results: 'ad-slot-home-results',
        userstats: 'ad-slot-userstats',
        leaderboards: 'ad-slot-leaderboards',
        friends: 'ad-slot-friends',
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
            // No-op when ads are off or this slot has no zone ID yet.
            if (!cfg.enabled || !zone) {
                el.setAttribute('hidden', '');
                el.setAttribute('aria-hidden', 'true');
                el.classList.remove('is-active');
                el.removeAttribute('data-zone');
                el.textContent = '';
                return;
            }

            el.removeAttribute('hidden');
            el.setAttribute('aria-hidden', 'false');
            el.classList.add('is-active');
            el.setAttribute('data-zone', zone);
            // Monetag (or a future wrapper) can target [data-zone] / #ad-slot-*.
            // Leave the node empty for the ad network to inject into.
            if (!el.getAttribute('data-ad-ready')) {
                el.setAttribute('data-ad-ready', '1');
            }
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

    // SPA navigations re-inject page HTML; re-bind slots when the route changes.
    window.addEventListener('usertypo:page-ready', refresh);
    window.addEventListener('popstate', function () {
        setTimeout(refresh, 0);
    });

    window.usertypoAds = {
        isLoaded: function () { return loaded; },
        refresh: refresh,
    };
})();
