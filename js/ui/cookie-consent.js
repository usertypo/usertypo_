/**
 * Cookie consent banner.
 * - Accept all → analytics + ads
 * - Essential only → no Google Analytics (ads still load when configured)
 * Public via window.usertypoConsent.openSettings()
 */
(function () {
    var root = null;
    var detailsOpen = false;

    function el(tag, className) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    }

    function hide() {
        if (!root) return;
        root.classList.add('is-hidden');
        root.setAttribute('aria-hidden', 'true');
        detailsOpen = false;
        var panel = root.querySelector('[data-consent-details]');
        if (panel) panel.classList.add('hidden');
        var toggle = root.querySelector('[data-consent-details-btn]');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function show() {
        ensureDom();
        root.classList.remove('is-hidden');
        root.setAttribute('aria-hidden', 'false');
    }

    function saveAndClose(analytics) {
        if (window.usertypoConsent) {
            window.usertypoConsent.set({
                acknowledged: true,
                analytics: !!analytics,
                advertising: true,
            });
        }
        hide();
    }

    function setDetailsOpen(open) {
        detailsOpen = !!open;
        var panel = root && root.querySelector('[data-consent-details]');
        var toggle = root && root.querySelector('[data-consent-details-btn]');
        if (panel) panel.classList.toggle('hidden', !detailsOpen);
        if (toggle) {
            toggle.setAttribute('aria-expanded', detailsOpen ? 'true' : 'false');
            toggle.textContent = detailsOpen ? 'Hide details' : 'See details';
        }
    }

    function ensureDom() {
        if (root) return root;
        root = el('div', 'usertypo-cookie-banner is-hidden');
        root.id = 'usertypo-cookie-banner';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'Cookie preferences');
        root.setAttribute('aria-hidden', 'true');

        root.innerHTML = [
            '<div class="usertypo-cookie-banner__inner glass-panel">',
            '  <div class="usertypo-cookie-banner__copy">',
            '    <p class="usertypo-cookie-banner__title">Cookies</p>',
            '    <p class="usertypo-cookie-banner__text">',
            '      We use cookies to maintain your experience.',
            '      <button type="button" class="usertypo-cookie-banner__link" data-consent-details-btn aria-expanded="false">See details</button>',
            '    </p>',
            '  </div>',
            '  <div class="usertypo-cookie-banner__details hidden" data-consent-details>',
            '    <div class="usertypo-cookie-row">',
            '      <div>',
            '        <p class="usertypo-cookie-row__label">Essential</p>',
            '        <p class="usertypo-cookie-row__hint">Sign-in (Clerk), theme preference, security/CDN (Cloudflare when enabled), and your cookie choice. Always on.</p>',
            '      </div>',
            '      <span class="usertypo-cookie-locked">On</span>',
            '    </div>',
            '    <div class="usertypo-cookie-row">',
            '      <div>',
            '        <p class="usertypo-cookie-row__label">Analytics</p>',
            '        <p class="usertypo-cookie-row__hint">Google Analytics 4 — page visits and active users. Off if you choose Essential only.</p>',
            '      </div>',
            '    </div>',
            '    <div class="usertypo-cookie-row">',
            '      <div>',
            '        <p class="usertypo-cookie-row__label">Advertising</p>',
            '        <p class="usertypo-cookie-row__hint">Third-party ads that help keep usertypo_ free (when an ad provider is configured).</p>',
            '      </div>',
            '    </div>',
            '    <p class="usertypo-cookie-banner__text usertypo-cookie-banner__text--tight">',
            '      Full details are in our',
            '      <a href="/privacy#cookies" data-spa-link class="usertypo-cookie-banner__link">Privacy Policy</a>.',
            '    </p>',
            '  </div>',
            '  <div class="usertypo-cookie-banner__actions">',
            '    <button type="button" class="usertypo-cookie-btn usertypo-cookie-btn--ghost" data-consent-essential>Essential only</button>',
            '    <button type="button" class="usertypo-cookie-btn usertypo-cookie-btn--primary" data-consent-accept-all>Accept all</button>',
            '  </div>',
            '</div>',
        ].join('');

        document.body.appendChild(root);

        root.querySelector('[data-consent-details-btn]').addEventListener('click', function () {
            setDetailsOpen(!detailsOpen);
        });
        root.querySelector('[data-consent-essential]').addEventListener('click', function () {
            saveAndClose(false);
        });
        root.querySelector('[data-consent-accept-all]').addEventListener('click', function () {
            saveAndClose(true);
        });

        return root;
    }

    function init() {
        ensureDom();
        window.addEventListener('usertypo:cookie-settings', function () {
            show();
            setDetailsOpen(true);
        });
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest && e.target.closest('[data-cookie-settings]');
            if (!btn) return;
            e.preventDefault();
            if (window.usertypoConsent && typeof window.usertypoConsent.openSettings === 'function') {
                window.usertypoConsent.openSettings();
            } else {
                show();
                setDetailsOpen(true);
            }
        });

        if (!window.usertypoConsent || !window.usertypoConsent.hasChoice()) {
            show();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
