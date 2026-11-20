/**
 * Cookie consent.
 * - First visit: a small "We use cookies." pill slides up from the bottom once the
 *   site has finished loading (after the boot/loading overlay is gone).
 *     · Tick button  → accept all.
 *     · Essential only → opens the choices panel so the user can see what is accepted.
 * - Opened from Settings / cookie links: the same choices panel.
 * Public via window.usertypoConsent.openSettings()
 */
(function () {
    var root = null;
    var leaveTimer = null;

    function isSiteReady() {
        var overlay = document.getElementById('spa-boot-overlay');
        return !overlay || overlay.hidden === true;
    }

    // Runs cb once the loading overlay has been dismissed (or right away if it already has).
    function whenSiteReady(cb) {
        if (isSiteReady()) {
            cb();
            return;
        }
        window.addEventListener('usertypo:boot-overlay-hidden', function onReady() {
            window.removeEventListener('usertypo:boot-overlay-hidden', onReady);
            cb();
        });
    }

    function hasChoice() {
        return !!(window.usertypoConsent && window.usertypoConsent.hasChoice());
    }

    function currentAnalytics() {
        var c = window.usertypoConsent && window.usertypoConsent.get();
        return !!(c && c.analytics);
    }

    // Keep the gap under the pill as tall as the page footer so it floats above it.
    function syncFooterGap() {
        if (!root) return;
        var footer = document.getElementById('test-view-footer');
        var h = footer ? footer.getBoundingClientRect().height : 0;
        root.style.paddingBottom = (h > 0 ? Math.round(h) : 42) + 'px';
    }

    function hide() {
        if (!root) return;
        clearTimeout(leaveTimer);
        var pill = root.querySelector('.usertypo-cookie-pill');
        if (pill && !root.classList.contains('is-hidden')) {
            pill.classList.add('is-leaving');
            leaveTimer = setTimeout(function () {
                root.classList.add('is-hidden');
                pill.classList.remove('is-leaving');
            }, 280);
        } else {
            root.classList.add('is-hidden');
        }
        root.setAttribute('aria-hidden', 'true');
    }

    // mode: 'pill' (slide-up prompt) or 'panel' (choices panel)
    function show(mode) {
        ensureDom();
        syncFooterGap();
        clearTimeout(leaveTimer);
        var pill = root.querySelector('.usertypo-cookie-pill');
        if (pill) pill.classList.remove('is-leaving');
        root.setAttribute('data-mode', mode === 'panel' ? 'panel' : 'pill');
        root.classList.remove('is-hidden');
        root.setAttribute('aria-hidden', 'false');
    }

    // Shows what each cookie group does for the given choice (analytics on/off).
    function renderPanel(analyticsOn) {
        var analyticsRow = root.querySelector('[data-cookie-row="analytics"]');
        if (!analyticsRow) return;
        var badge = analyticsRow.querySelector('.usertypo-cookie-panel__badge');
        badge.textContent = analyticsOn ? 'Accepted' : 'Not accepted';
        badge.classList.toggle('is-on', !!analyticsOn);
        analyticsRow.classList.toggle('is-on', !!analyticsOn);
    }

    function openPanel(analyticsOn) {
        renderPanel(analyticsOn);
        show('panel');
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

    function ensureDom() {
        if (root) return root;
        root = document.createElement('div');
        root.className = 'usertypo-cookie-banner is-hidden';
        root.id = 'usertypo-cookie-banner';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'Cookie preferences');
        root.setAttribute('aria-hidden', 'true');
        root.setAttribute('data-mode', 'pill');

        root.innerHTML = [
            // Minimal pill (first visit)
            '<div class="usertypo-cookie-pill">',
            '  <p class="usertypo-cookie-pill__text">We use cookies.</p>',
            '  <div class="usertypo-cookie-pill__actions">',
            '    <button type="button" class="usertypo-cookie-pill__essential" data-consent-open-panel>Essential only</button>',
            '    <button type="button" class="usertypo-cookie-pill__ok" data-consent-accept-all aria-label="Accept all cookies">',
            '      <span class="material-symbols-outlined" aria-hidden="true">check</span>',
            '    </button>',
            '  </div>',
            '</div>',
            // Choices panel (after Essential only, or from Settings)
            '<div class="usertypo-cookie-panel" role="group" aria-label="Cookies being accepted">',
            '  <p class="usertypo-cookie-panel__title">Cookies</p>',
            '  <div class="usertypo-cookie-panel__rows">',
            '    <div class="usertypo-cookie-panel__row is-on">',
            '      <div class="usertypo-cookie-panel__copy">',
            '        <p class="usertypo-cookie-panel__label">Essential</p>',
            '        <p class="usertypo-cookie-panel__hint">Sign-in (Clerk), theme preference, security/CDN (Cloudflare when enabled), and your cookie choice.</p>',
            '      </div>',
            '      <span class="usertypo-cookie-panel__badge is-on">Always on</span>',
            '    </div>',
            '    <div class="usertypo-cookie-panel__row" data-cookie-row="analytics">',
            '      <div class="usertypo-cookie-panel__copy">',
            '        <p class="usertypo-cookie-panel__label">Analytics</p>',
            '        <p class="usertypo-cookie-panel__hint">Google Analytics 4 — page visits and active users.</p>',
            '      </div>',
            '      <span class="usertypo-cookie-panel__badge">Not accepted</span>',
            '    </div>',
            '    <div class="usertypo-cookie-panel__row is-on">',
            '      <div class="usertypo-cookie-panel__copy">',
            '        <p class="usertypo-cookie-panel__label">Advertising</p>',
            '        <p class="usertypo-cookie-panel__hint">Third-party ads that help keep usertypo_ free.</p>',
            '      </div>',
            '      <span class="usertypo-cookie-panel__badge is-on">Accepted</span>',
            '    </div>',
            '  </div>',
            '  <p class="usertypo-cookie-panel__more">Full details are in our <a href="/privacy#cookies" data-spa-link>Privacy Policy</a>.</p>',
            '  <div class="usertypo-cookie-panel__actions">',
            '    <button type="button" class="usertypo-cookie-panel__btn usertypo-cookie-panel__btn--ghost" data-consent-essential>Essential only</button>',
            '    <button type="button" class="usertypo-cookie-panel__btn usertypo-cookie-panel__btn--primary" data-consent-accept-all>Accept all</button>',
            '  </div>',
            '</div>',
        ].join('');

        document.body.appendChild(root);

        root.querySelector('[data-consent-open-panel]').addEventListener('click', function () {
            openPanel(false);
        });
        root.querySelectorAll('[data-consent-essential]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                saveAndClose(false);
            });
        });
        root.querySelectorAll('[data-consent-accept-all]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                saveAndClose(true);
            });
        });

        return root;
    }

    function init() {
        ensureDom();
        window.addEventListener('resize', syncFooterGap);
        window.addEventListener('usertypo:cookie-settings', function () {
            openPanel(currentAnalytics());
        });
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest && e.target.closest('[data-cookie-settings]');
            if (!btn) return;
            e.preventDefault();
            if (window.usertypoConsent && typeof window.usertypoConsent.openSettings === 'function') {
                window.usertypoConsent.openSettings();
            } else {
                openPanel(currentAnalytics());
            }
        });

        // Only prompt after the loading screen has gone and only if no choice was saved yet.
        if (!hasChoice()) {
            whenSiteReady(function () {
                if (!hasChoice()) show('pill');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
