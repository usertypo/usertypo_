/**
 * GA4 loader — only when analytics consent is granted.
 * Public: window.usertypoAnalytics
 */
(function () {
    var loaded = false;
    var measurementId = '';

    function getMeasurementId() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.analytics) || {};
        var id = String(cfg.ga4MeasurementId || '').trim();
        return /^G-[A-Z0-9]+$/i.test(id) ? id : '';
    }

    function ensureDataLayer() {
        window.dataLayer = window.dataLayer || [];
        if (typeof window.gtag !== 'function') {
            window.gtag = function () {
                window.dataLayer.push(arguments);
            };
        }
    }

    function loadGtag(id) {
        if (loaded || !id) return false;
        loaded = true;
        measurementId = id;
        ensureDataLayer();
        window.gtag('js', new Date());
        window.gtag('consent', 'update', {
            analytics_storage: 'granted',
        });
        window.gtag('config', id, {
            send_page_view: false,
            anonymize_ip: true,
        });

        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
        document.head.appendChild(script);
        return true;
    }

    function disableAnalytics() {
        if (!loaded || typeof window.gtag !== 'function') return;
        try {
            window.gtag('consent', 'update', {
                analytics_storage: 'denied',
            });
        } catch (e) { /* ignore */ }
    }

    function trackPageView() {
        if (!loaded || !measurementId || typeof window.gtag !== 'function') return;
        var consent = window.usertypoConsent && window.usertypoConsent.get();
        if (consent && consent.analytics === false) return;
        try {
            window.gtag('event', 'page_view', {
                page_title: document.title,
                page_location: location.href,
                page_path: location.pathname + location.search,
            });
        } catch (e) { /* ignore */ }
    }

    function syncFromConsent(consent, options) {
        if (!consent || !consent.acknowledged) return;
        if (!consent.analytics) {
            disableAnalytics();
            return;
        }
        var id = getMeasurementId();
        if (!id) return;
        var justLoaded = loadGtag(id);
        if (justLoaded && options && options.trackNow) trackPageView();
    }

    function init() {
        if (!window.usertypoConsent) return;
        var current = window.usertypoConsent.get();
        if (current) syncFromConsent(current);
        window.usertypoConsent.onChange(function (consent) {
            syncFromConsent(consent, { trackNow: true });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.usertypoAnalytics = {
        trackPageView: trackPageView,
        isLoaded: function () { return loaded; },
    };
})();
