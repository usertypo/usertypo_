/**
 * usertypo_ SPA Router
 */
(function () {
    'use strict';

    const routes = {
        '/': { page: 'pages/home.html', title: 'Home - Typing Test | usertypo_', navId: 'nav-typing', hideShellFooter: true, compact: false, typingLayout: true },
        '/settings': { page: 'pages/settings.html', title: 'Settings - Configure Your Experience | usertypo_', navId: 'nav-settings', compact: false },
        '/signin': { page: 'pages/signin.html', title: 'Sign In - Continue the Fun! | usertypo_', navId: null, compact: false, signinLayout: true, hideShellFooter: true },
        '/friends': { page: 'pages/friends.html', title: 'Friends | usertypo_', navId: 'nav-friends', compact: true },
        '/room': { page: 'pages/room.html', title: 'Room | usertypo_', navId: null, compact: true, typingLayout: true, hideShellFooter: true },
        '/dual': { page: 'pages/dual.html', title: 'Dual Match | usertypo_', navId: null, compact: true, typingLayout: true, hideShellHeader: true, hideShellFooter: true },
        '/leaderboards': { page: 'pages/leaderboards.html', title: 'Leaderboards | usertypo_', navId: 'nav-leaderboards', compact: false },
        '/userstats': { page: 'pages/userstats.html', title: 'User Stats | usertypo_', navId: 'nav-userstats', compact: false },
    };

    const htmlRouteMap = {
        'index.html': '/',
        'settings.html': '/settings',
        'signin.html': '/signin',
        'friends.html': '/friends',
        'room.html': '/room',
        'dual.html': '/dual',
        'leaderboards.html': '/leaderboards',
        'userstats.html': '/userstats',
    };

    let isNavigating = false;
    let activePageStyleEl = null;

    function normalizePath(pathname) {
        let p = pathname || '/';
        if (p.endsWith('/index.html')) p = p.replace(/\/index\.html$/, '/') || '/';
        if (p.endsWith('.html')) {
            const file = p.split('/').pop();
            if (htmlRouteMap[file]) return htmlRouteMap[file];
        }
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        return p || '/';
    }

    function parseRouteFromLocation() {
        const path = normalizePath(window.location.pathname);
        return { path, route: routes[path] || null };
    }

    function buildUrl(path, queryString) {
        if (!queryString) return path;
        if (queryString.startsWith('?')) return path + queryString;
        return path + '?' + queryString;
    }

    window.navigateTo = function navigateTo(path, queryParams) {
        let targetPath = path;
        let search = '';
        if (path.includes('?')) {
            const parts = path.split('?');
            targetPath = parts[0];
            search = '?' + parts[1];
        } else if (queryParams && typeof queryParams === 'object') {
            const qs = new URLSearchParams(queryParams).toString();
            if (qs) search = '?' + qs;
        }
        targetPath = normalizePath(targetPath);
        const url = buildUrl(targetPath, search);
        if (url === window.location.pathname + window.location.search) {
            return loadRoute(targetPath);
        }
        history.pushState({ spa: true, path: targetPath, search }, '', url);
        return loadRoute(targetPath);
    };

    function parseFragment(html) {
        const styles = [];
        const scripts = [];
        let content = html;
        content = content.replace(/<style[\s\S]*?<\/style>/gi, function (m) {
            styles.push(m);
            return '';
        });
        content = content.replace(/<script[\s\S]*?<\/script>/gi, function (m) {
            scripts.push(m);
            return '';
        });
        return { content: content.trim(), styles, scripts };
    }

    function looksLikeSpaShell(html) {
        if (!html || typeof html !== 'string') return true;
        // Shell markers — page fragments must never contain these IDs / docs
        if (/id=["']spa-page-root["']/i.test(html)) return true;
        if (/id=["']spa-shell-footer["']/i.test(html)) return true;
        if (/id=["']spa-content["']/i.test(html)) return true;
        if (/id=["']expanding-bubble["']/i.test(html)) return true;
        if (/id=["']app-body["']/i.test(html)) return true;
        if (/<html[\s>]/i.test(html)) return true;
        if (/js\/router\.js/i.test(html)) return true;
        return false;
    }

    function injectPageStyles(styles, path) {
        if (activePageStyleEl) {
            activePageStyleEl.remove();
            activePageStyleEl = null;
        }
        if (!styles.length) return;
        const holder = document.createElement('div');
        holder.id = 'spa-page-styles';
        holder.setAttribute('data-route', path);
        holder.innerHTML = styles.join('\n');
        document.head.appendChild(holder);
        activePageStyleEl = holder;
        if (window.tailwind && typeof window.tailwind.refresh === 'function') {
            try { window.tailwind.refresh(); } catch (e) { /* ignore */ }
        }
    }

    function resetShellZenElements() {
        document.querySelectorAll('.zen-element').forEach(function (el) {
            el.classList.remove('zen-hidden');
            el.style.opacity = '';
            el.style.pointerEvents = '';
        });
    }

    function resetShellHeaderChrome() {
        var headerLeft = document.getElementById('header-left');
        var headerRight = document.getElementById('header-right');
        var headerLogo = document.getElementById('header-logo-link');
        if (headerLeft) headerLeft.classList.remove('opacity-0', 'pointer-events-none');
        if (headerRight) headerRight.classList.remove('opacity-0', 'pointer-events-none');
        if (headerLogo) headerLogo.style.pointerEvents = '';
    }

    function cleanupShellState() {
        if (typeof window.__spaPageCleanup === 'function') {
            try { window.__spaPageCleanup(); } catch (e) { console.warn('__spaPageCleanup', e); }
        }

        document.querySelectorAll('[inert]').forEach(function (el) {
            el.removeAttribute('inert');
        });
        document.body.style.userSelect = '';
        document.body.style.overflow = '';
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'auto';
        }

        resetShellZenElements();
        resetShellHeaderChrome();

        var nm = document.getElementById('notifications-modal');
        var nb = document.getElementById('notifications-box');
        if (nm) nm.classList.add('pointer-events-none');
        if (nb) { nb.classList.add('scale-95', 'opacity-0'); nb.classList.remove('scale-100', 'opacity-100'); }

        var cp = document.getElementById('custom-prompt-modal');
        var cpb = document.getElementById('custom-prompt-box');
        if (cp) cp.classList.add('opacity-0', 'pointer-events-none');
        if (cpb) cpb.classList.remove('scale-100');

        document.querySelectorAll('script[data-spa-page-script]').forEach(function (s) {
            s.remove();
        });

        window.__spaPageCleanup = null;
        window.__spaPageInit = null;
    }

    function executeScripts(scriptTags, path) {
        return scriptTags.reduce(function (promise, tagHtml) {
            return promise.then(function () {
                return new Promise(function (resolve) {
                    var tmp = document.createElement('div');
                    tmp.innerHTML = tagHtml;
                    var old = tmp.querySelector('script');
                    if (!old) { resolve(); return; }
                    if (old.src) {
                        var script = document.createElement('script');
                        script.setAttribute('data-spa-page-script', '1');
                        script.src = old.src;
                        script.onload = function () { resolve(); };
                        script.onerror = function () { resolve(); };
                        document.body.appendChild(script);
                        return;
                    }
                    // Run inline scripts in a fresh function scope so let/const can
                    // be redeclared on every route visit (classic <script> tags share
                    // one global lexical scope and throw on the second run).
                    try {
                        var runPageScript = new Function(old.textContent);
                        runPageScript();
                    } catch (e) {
                        console.error('SPA page script error (' + (path || 'unknown') + '):', e);
                    }
                    resolve();
                });
            });
        }, Promise.resolve());
    }

    function restartAnimations(container) {
        container.querySelectorAll('.animate-fade-in-up, .animate-fade-in, [class*="animate-"]').forEach(function (el) {
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = '';
        });
    }

    function reinitializeSharedModules(path) {
        const routePath = path || (location.pathname || '').replace(/\/+$/, '') || '/';
        const onTypingPage = routePath === '/' || routePath === '/room' || routePath === '/dual';

        if (typeof window._initLang === 'function') {
            try { window._initLang({ skipRestart: !onTypingPage }); } catch (e) { console.warn('_initLang', e); }
        }
        if (window.usertypo_footerPicker && typeof window.usertypo_footerPicker.init === 'function') {
            try { window.usertypo_footerPicker.init(); } catch (e) { console.warn('footerPicker', e); }
        }
        if (window.usertypo_settingsApi) {
            try {
                var settings = window.usertypo_settingsApi.loadSettings();
                window.usertypo_settingsApi.applyAllSettings(settings);
            } catch (e) { console.warn('settingsApi', e); }
        }
        if (typeof applyFooterSettings === 'function') {
            try { applyFooterSettings(); } catch (e) { console.warn('applyFooterSettings', e); }
        }
        wireShellMuteButtons();
    }

    function wireShellMuteButtons() {
        document.querySelectorAll('.footer-mute-btn').forEach(function (btn) {
            if (btn.dataset.spaMuteWired) return;
            btn.dataset.spaMuteWired = '1';
            btn.addEventListener('mousedown', function (e) {
                e.preventDefault();
            });
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (typeof toggleFooterMute === 'function') toggleFooterMute();
            });
        });
    }

    function updateNavActive(navId) {
        document.querySelectorAll('.bubble-nav-link').forEach(function (link) {
            link.classList.remove('is-active');
        });
        if (navId) {
            var el = document.getElementById(navId);
            if (el) el.classList.add('is-active');
        }
    }

    function updateShellFooter(routeConfig) {
        var footer = document.getElementById('spa-shell-footer');
        if (!footer) return;
        if (routeConfig && routeConfig.hideShellFooter) footer.classList.add('hidden');
        else footer.classList.remove('hidden');
    }

    function updateShellHeader(routeConfig) {
        var header = document.querySelector('body > header');
        if (!header) return;
        if (routeConfig && routeConfig.hideShellHeader) header.classList.add('hidden');
        else header.classList.remove('hidden');
    }

    function getPageContainer() {
        return document.getElementById('spa-page-root') || document.getElementById('spa-content');
    }

    function updateShellLayout(routeConfig) {
        var body = document.getElementById('app-body');
        var content = document.getElementById('spa-content');
        var pageRoot = document.getElementById('spa-page-root');
        if (!body || !content) return;

        var compact = !!(routeConfig && routeConfig.compact);
        var typing = !!(routeConfig && routeConfig.typingLayout);
        var signin = !!(routeConfig && routeConfig.signinLayout);
        var lockedViewport = compact || typing || signin;

        body.classList.toggle('h-screen', lockedViewport);
        body.classList.toggle('overflow-hidden', lockedViewport);
        body.classList.toggle('min-h-screen', !lockedViewport);
        body.classList.toggle('overflow-y-auto', !lockedViewport);
        body.classList.toggle('overflow-x-hidden', true);

        content.classList.toggle('min-h-0', lockedViewport);
        content.classList.toggle('overflow-hidden', lockedViewport);
        if (pageRoot) {
            pageRoot.classList.toggle('min-h-0', lockedViewport);
            pageRoot.classList.toggle('overflow-hidden', lockedViewport);
        }
    }

    function prepareRoomView() {
        var appViews = document.getElementById('app-views');
        var lobbyView = document.getElementById('lobby-view');
        var testView = document.getElementById('test-view');
        var statsView = document.getElementById('stats-view');
        if (appViews) {
            appViews.classList.add('h-full', 'min-h-0');
        }
        if (lobbyView) {
            lobbyView.style.display = '';
            lobbyView.classList.remove('hidden', 'opacity-0');
            lobbyView.classList.add('flex-1', 'flex', 'flex-col');
        }
        if (testView) {
            testView.classList.add('hidden', 'opacity-0');
            testView.style.display = 'none';
        }
        if (statsView) {
            statsView.classList.add('hidden', 'opacity-0');
            statsView.style.display = 'none';
        }
        var headerLeft = document.getElementById('header-left');
        var headerRight = document.getElementById('header-right');
        var headerLogo = document.getElementById('header-logo-link');
        if (headerLeft) headerLeft.classList.add('opacity-0', 'pointer-events-none');
        if (headerRight) headerRight.classList.add('opacity-0', 'pointer-events-none');
        if (headerLogo) headerLogo.style.pointerEvents = 'none';
    }

    function prepareDualTypingView() {
        var appViews = document.getElementById('app-views');
        var testView = document.getElementById('test-view');
        var statsView = document.getElementById('stats-view');
        if (appViews) {
            appViews.classList.add('h-full', 'min-h-0');
        }
        if (testView) {
            testView.style.display = 'flex';
            testView.classList.remove('hidden', 'opacity-0');
            testView.classList.add('flex-1', 'flex', 'flex-col');
        }
        if (statsView) {
            statsView.classList.add('hidden', 'opacity-0');
            statsView.classList.remove('flex');
            statsView.style.display = 'none';
        }
        if (typeof window.usertypo_lockTypingScroll === 'function') {
            window.usertypo_lockTypingScroll();
        }
    }

    function prepareHomeTypingView() {
        var testView = document.getElementById('test-view');
        var statsView = document.getElementById('stats-view');
        if (testView) {
            testView.style.display = 'flex';
            testView.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
            testView.classList.add('flex-1', 'flex');
        }
        if (statsView) {
            statsView.classList.add('hidden', 'opacity-0');
            statsView.classList.remove('flex-1', 'flex');
            statsView.style.display = 'none';
        }
        var testFooter = document.getElementById('test-view-footer');
        if (testFooter) testFooter.style.display = '';
    }

    async function loadPageHtml(pagePath) {
        // Embedded fragments work on ANY static server, including ones that
        // rewrite /pages/* → index.html (npx serve + bad SPA config, etc.).
        if (typeof window.__USERTYPO_GET_PAGE_FRAGMENT__ === 'function') {
            var embedded = window.__USERTYPO_GET_PAGE_FRAGMENT__(pagePath);
            if (embedded) return embedded;
        }
        if (window.__USERTYPO_PAGE_FRAGMENTS__ && window.__USERTYPO_PAGE_FRAGMENTS__[pagePath]) {
            return window.__USERTYPO_PAGE_FRAGMENTS__[pagePath];
        }

        var candidates = [];
        if (pagePath.charAt(0) === '/') candidates.push(pagePath);
        else {
            candidates.push('/' + pagePath);
            candidates.push(pagePath);
        }

        var lastErr = null;
        for (var i = 0; i < candidates.length; i++) {
            try {
                var res = await fetch(candidates[i] + '?t=' + Date.now());
                if (!res.ok) {
                    lastErr = new Error('HTTP ' + res.status + ' for ' + candidates[i]);
                    continue;
                }
                var html = await res.text();
                if (looksLikeSpaShell(html)) {
                    lastErr = new Error('SPA shell returned for ' + candidates[i]);
                    continue;
                }
                return html;
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error('Failed to load ' + pagePath);
    }

    async function loadRoute(path) {
        if (isNavigating) return;
        isNavigating = true;

        var routeConfig = routes[path];
        var container = getPageContainer();
        var spaContent = document.getElementById('spa-content');

        cleanupShellState();

        if (!routeConfig || !container) {
            if (container) {
                container.innerHTML = '<div class="flex flex-col items-center justify-center flex-1 p-12 text-slate-400"><h1 class="text-2xl font-bold text-white mb-2">Page not found</h1><a href="/" data-spa-link class="text-primary hover:underline">Go home</a></div>';
            }
            isNavigating = false;
            return;
        }

        try {
            var html = await loadPageHtml(routeConfig.page);

            var parsed = parseFragment(html);
            injectPageStyles(parsed.styles, path);
            container.innerHTML = parsed.content;
            restartAnimations(spaContent || container);

            // Always re-execute page scripts on every visit
            if (parsed.scripts.length) {
                await executeScripts(parsed.scripts, path);
            }

            document.title = routeConfig.title;
            updateNavActive(routeConfig.navId);
            updateShellFooter(routeConfig);
            updateShellHeader(routeConfig);
            updateShellLayout(routeConfig);
            window.scrollTo(0, 0);

            if (typeof window.__spaPageInit === 'function') {
                try { window.__spaPageInit(); } catch (e) { console.warn('__spaPageInit', e); }
            }

            if (path === '/settings' && window.usertypo_settingsApi && typeof window.usertypo_settingsApi.initSettingsPage === 'function') {
                try { window.usertypo_settingsApi.initSettingsPage(); } catch (e) { console.warn('initSettingsPage', e); }
            }

            reinitializeSharedModules(path);

            if (path === '/') {
                prepareHomeTypingView();
                if (typeof window.restartTest === 'function') {
                    setTimeout(function () {
                        try { window.restartTest(); } catch (e) { console.warn('restartTest', e); }
                    }, 0);
                }
            }

            if (path === '/dual' && window.DualMatch && typeof window.DualMatch._resetJoining === 'function') {
                try { window.DualMatch._resetJoining(); } catch (e) { /* ignore */ }
            }

            if (path === '/dual') {
                prepareDualTypingView();
            }

            if (path === '/room') {
                prepareRoomView();
            }
        } catch (err) {
            console.error('SPA load failed:', err);
            container.innerHTML = '<div class="p-12 text-red-400">Failed to load page.</div>';
        }

        isNavigating = false;
    }

    function interceptLinkClick(e) {
        var link = e.target.closest('a[href]');
        if (!link || link.hasAttribute('download')) return;
        if (link.target && link.target !== '_self') return;
        var href = link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('http')) return;
        var path = href.split('?')[0];
        var search = href.includes('?') ? '?' + href.split('?')[1] : '';
        var base = path.split('/').pop();
        if (htmlRouteMap[base]) path = htmlRouteMap[base];
        else if (path.startsWith('/')) path = normalizePath(path);
        else return;
        if (!routes[normalizePath(path.split('?')[0])]) return;
        e.preventDefault();
        var routePath = normalizePath(path.split('?')[0]);
        history.pushState({ spa: true, path: routePath, search: search }, '', buildUrl(routePath, search));
        loadRoute(routePath);
    }

    document.addEventListener('click', interceptLinkClick, true);

    window.addEventListener('popstate', function () {
        var loc = parseRouteFromLocation();
        loadRoute(loc.path);
    });

    function unlockStatsScroll() {
        var body = document.getElementById('app-body');
        var content = document.getElementById('spa-content');
        var pageRoot = document.getElementById('spa-page-root');
        var appViews = document.getElementById('app-views');
        if (body) {
            body.classList.remove('h-screen', 'overflow-hidden');
            body.classList.add('min-h-screen', 'overflow-y-auto', 'overflow-x-hidden');
        }
        if (content) {
            content.classList.remove('min-h-0', 'overflow-hidden');
        }
        if (pageRoot) {
            pageRoot.classList.remove('min-h-0', 'overflow-hidden');
        }
        if (appViews) {
            appViews.classList.remove('h-full', 'min-h-0', 'overflow-hidden');
        }
    }

    function lockTypingScroll() {
        var body = document.getElementById('app-body');
        var content = document.getElementById('spa-content');
        var pageRoot = document.getElementById('spa-page-root');
        var appViews = document.getElementById('app-views');
        if (body) {
            body.classList.remove('min-h-screen', 'overflow-y-auto');
            body.classList.add('h-screen', 'overflow-hidden', 'overflow-x-hidden');
        }
        if (content) {
            content.classList.add('min-h-0', 'overflow-hidden');
        }
        if (pageRoot) {
            pageRoot.classList.add('min-h-0', 'overflow-hidden');
        }
        if (appViews) {
            appViews.classList.add('h-full', 'min-h-0');
        }
    }

    window.usertypo_unlockStatsScroll = unlockStatsScroll;
    window.usertypo_lockTypingScroll = lockTypingScroll;

    document.addEventListener('DOMContentLoaded', function () {
        wireShellMuteButtons();
        var loc = parseRouteFromLocation();
        if (!routes[loc.path]) {
            history.replaceState({ spa: true, path: '/' }, '', '/');
            loadRoute('/');
        } else {
            loadRoute(loc.path);
        }
    });
})();
