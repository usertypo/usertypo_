/**
 * usertypo_ SPA Router
 */
(function () {
    'use strict';

    // Capture the real document entry URL before any SPA navigation.
    // Used to detect full-page reloads on /room or /dual (not SPA navigations after a reload elsewhere).
    if (!window.__usertypoBootPath) {
        window.__usertypoBootPath = String(window.location.pathname || '/');
    }

    const SITE_ORIGIN = 'https://usertypo.com';
    const DEFAULT_DESCRIPTION = 'Free online typing test by usertypo_. Track WPM and accuracy, climb leaderboards, and race friends in real-time multiplayer.';

    var scriptLoadCache = Object.create(null);

    function loadScriptOnce(src) {
        if (scriptLoadCache[src]) return scriptLoadCache[src];
        scriptLoadCache[src] = new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-usertypo-lazy="' + src + '"]');
            if (existing) {
                if (existing.dataset.loaded === '1') return resolve();
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); });
                return;
            }
            var script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.dataset.usertypoLazy = src;
            script.onload = function () {
                script.dataset.loaded = '1';
                resolve();
            };
            script.onerror = function () {
                delete scriptLoadCache[src];
                reject(new Error('Failed to load ' + src));
            };
            document.body.appendChild(script);
        });
        return scriptLoadCache[src];
    }

    function ensureRouteScripts(path) {
        var jobs = [];
        if (path === '/room') {
            jobs.push(loadScriptOnce('js/pages/room-race.js?v=35'));
        }
        if (path === '/dual') {
            jobs.push(loadScriptOnce('js/pages/dual-race.js?v=27'));
        }
        if (path === '/userstats') {
            jobs.push(loadScriptOnce('js/api/performance-chart.js?v=10'));
            jobs.push(loadScriptOnce('js/ui/avatar-editor.js?v=3'));
        }
        if (path === '/settings') {
            jobs.push(loadScriptOnce('js/ui/avatar-editor.js?v=3'));
        }
        return Promise.all(jobs);
    }

    const routes = {
        '/': {
            page: 'pages/home.html',
            title: 'Home - Typing Test | usertypo_',
            description: DEFAULT_DESCRIPTION,
            robots: 'index, follow',
            navId: 'nav-typing',
            hideShellFooter: true,
            compact: false,
            typingLayout: true,
        },
        '/settings': {
            page: 'pages/settings.html',
            title: 'Settings - Configure Your Experience | usertypo_',
            description: 'Configure themes, typing behavior, privacy, and account settings for usertypo_.',
            robots: 'noindex, nofollow',
            navId: 'nav-settings',
            compact: false,
        },
        '/signin': {
            page: 'pages/auth/signin.html',
            title: 'Sign In - Continue the Fun! | usertypo_',
            description: 'Sign in to usertypo_ to save progress, join leaderboards, and play multiplayer.',
            robots: 'noindex, nofollow',
            navId: null,
            compact: false,
            signinLayout: true,
            hideShellFooter: true,
        },
        '/sso-callback': {
            page: 'pages/auth/sso-callback.html',
            title: 'Signing in... | usertypo_',
            description: 'Completing sign-in to usertypo_.',
            robots: 'noindex, nofollow',
            navId: null,
            compact: false,
            hideShellFooter: true,
            hideShellHeader: true,
        },
        '/friends': {
            page: 'pages/friends.html',
            title: 'Friends | usertypo_',
            description: 'Manage friends, find opponents, and start multiplayer typing races on usertypo_.',
            robots: 'noindex, follow',
            navId: 'nav-friends',
            compact: true,
        },
        '/room': {
            page: 'pages/room.html',
            title: 'Room | usertypo_',
            description: 'Multiplayer typing room on usertypo_.',
            robots: 'noindex, nofollow',
            navId: null,
            compact: true,
            typingLayout: true,
            hideShellFooter: true,
        },
        '/dual': {
            page: 'pages/dual.html',
            title: 'Dual Match | usertypo_',
            description: '1v1 typing race on usertypo_.',
            robots: 'noindex, nofollow',
            navId: null,
            compact: true,
            typingLayout: true,
            hideShellHeader: true,
            hideShellFooter: true,
        },
        '/leaderboards': {
            page: 'pages/leaderboards.html',
            title: 'Leaderboards | usertypo_',
            description: 'Global and friends typing leaderboards on usertypo_. Compare WPM, accuracy, and climb the ranks.',
            robots: 'index, follow',
            navId: 'nav-leaderboards',
            compact: false,
        },
        '/userstats': {
            page: 'pages/userstats.html',
            title: 'User Stats | usertypo_',
            description: 'Your typing stats, personal bests, and history on usertypo_.',
            robots: 'noindex, follow',
            navId: 'nav-userstats',
            compact: false,
        },
        '/privacy': {
            page: 'pages/privacy.html',
            title: 'Privacy Policy | usertypo_',
            description: 'How usertypo_ collects, uses, and protects your data.',
            robots: 'index, follow',
            navId: null,
            compact: false,
        },
        '/terms': {
            page: 'pages/terms.html',
            title: 'Terms and Conditions | usertypo_',
            description: 'Terms and conditions for using usertypo_.',
            robots: 'index, follow',
            navId: null,
            compact: false,
        },
        '/about': {
            page: 'pages/about.html',
            title: 'About | usertypo_',
            description: 'Learn about usertypo_ — a free open-source typing test with leaderboards and multiplayer races.',
            robots: 'index, follow',
            navId: null,
            compact: false,
        },
        '/how-it-works': {
            page: 'pages/how-it-works.html',
            title: 'How Scoring Works | usertypo_',
            description: 'Technical details for WPM, accuracy, consistency, result graphs, Profile stats, XP levels, and leaderboard rankings on usertypo_.',
            robots: 'index, follow',
            navId: null,
            compact: false,
        },
        '/security': {
            page: 'pages/security.html',
            title: 'Security Policy | usertypo_',
            description: 'Security policy and how to report vulnerabilities for usertypo_.',
            robots: 'index, follow',
            navId: null,
            compact: false,
        },
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
        'privacy.html': '/privacy',
        'terms.html': '/terms',
        'about.html': '/about',
        'how-it-works.html': '/how-it-works',
        'security.html': '/security',
    };

    let isNavigating = false;
    let queuedPath = null;
    let activePageStyleEl = null;

    function normalizePath(pathname) {
        let p = pathname || '/';
        const joinMatch = p.match(/^\/join\/(\d{4})$/);
        if (joinMatch) return '/room';
        if (p.endsWith('/index.html')) p = p.replace(/\/index\.html$/, '/') || '/';
        if (p.endsWith('.html')) {
            const file = p.split('/').pop();
            if (htmlRouteMap[file]) return htmlRouteMap[file];
        }
        if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
        return p || '/';
    }

    function parseRouteFromLocation() {
        const joinMatch = window.location.pathname.match(/^\/join\/(\d{4})$/);
        if (joinMatch) {
            const search = '?code=' + encodeURIComponent(joinMatch[1]);
            history.replaceState({ spa: true, path: '/room', search: search }, '', '/room' + search);
            return { path: '/room', route: routes['/room'] || null };
        }
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

    function setMetaById(id, attr, value) {
        var el = document.getElementById(id);
        if (!el || value == null) return;
        if (attr === 'text') {
            el.textContent = value;
            return;
        }
        el.setAttribute(attr, value);
    }

    function updateDocumentSeo(path, routeConfig) {
        if (!routeConfig) return;
        var title = routeConfig.title || 'usertypo_';
        var description = routeConfig.description || DEFAULT_DESCRIPTION;
        var robots = routeConfig.robots || 'index, follow';
        var canonicalPath = path === '/' ? '/' : path;
        var canonicalUrl = SITE_ORIGIN + canonicalPath;

        document.title = title;
        setMetaById('meta-description', 'content', description);
        setMetaById('meta-robots', 'content', robots);
        setMetaById('meta-canonical', 'href', canonicalUrl);
        setMetaById('og-title', 'content', title);
        setMetaById('og-description', 'content', description);
        setMetaById('og-url', 'content', canonicalUrl);
        setMetaById('twitter-title', 'content', title);
        setMetaById('twitter-description', 'content', description);
    }

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
        // Shell-only markers. Do NOT use ids pages may reuse (e.g. dual's #expanding-bubble).
        if (/id=["']spa-page-root["']/i.test(html)) return true;
        if (/id=["']spa-shell-footer["']/i.test(html)) return true;
        if (/id=["']spa-content["']/i.test(html)) return true;
        if (/id=["']app-body["']/i.test(html)) return true;
        if (/js\/router\.js/i.test(html)) return true;
        if (/<html[\s>]/i.test(html) && /<\/html>/i.test(html)) return true;
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
        if (cp) {
            cp.classList.add('opacity-0', 'pointer-events-none');
            cp.classList.remove('opacity-100', 'pointer-events-auto');
            cp.setAttribute('aria-hidden', 'true');
        }
        if (cpb) {
            cpb.classList.add('scale-95', 'opacity-0');
            cpb.classList.remove('scale-100', 'opacity-100');
        }

        document.querySelectorAll('script[data-spa-page-script]').forEach(function (s) {
            s.remove();
        });

        window.__spaPageCleanup = null;
        window.__spaPageInit = null;
    }

    function executeScripts(scriptTags, path) {
        return scriptTags.reduce(function (promise, tagHtml) {
            return promise.then(function () {
                return new Promise(function (resolve, reject) {
                    var tmp = document.createElement('div');
                    tmp.innerHTML = tagHtml;
                    var old = tmp.querySelector('script');
                    if (!old) { resolve(); return; }
                    if (old.src) {
                        var script = document.createElement('script');
                        script.setAttribute('data-spa-page-script', '1');
                        script.src = old.src;
                        script.onload = function () { resolve(); };
                        script.onerror = function () { reject(new Error('Failed to load page script: ' + old.src)); };
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
                        // Keep the page visible; a single bad inline script should not
                        // wipe the route with "Failed to load page".
                        console.error('SPA page script error (' + (path || 'unknown') + '):', e);
                    }
                    resolve();
                });
            });
        }, Promise.resolve());
    }

    function restartAnimations(container) {
        // Prefer class toggle over reading offsetWidth (forced reflow) for every animated node.
        container.querySelectorAll('.animate-fade-in-up, .animate-fade-in, [class*="animate-"]').forEach(function (el) {
            el.classList.add('usertypo-anim-restart');
        });
        requestAnimationFrame(function () {
            container.querySelectorAll('.usertypo-anim-restart').forEach(function (el) {
                el.classList.remove('usertypo-anim-restart');
            });
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

    var BACK_TO_TOP_ROUTES = {
        '/about': true,
        '/how-it-works': true,
        '/terms': true,
        '/privacy': true,
        '/security': true,
    };
    var backToTopEnabled = false;

    function getWindowScrollTop() {
        var bodyEl = document.getElementById('app-body');
        return Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            bodyEl ? (bodyEl.scrollTop || 0) : 0
        );
    }

    function syncBackToTopVisibility() {
        var btn = document.getElementById('back-to-top-btn');
        if (!btn || !backToTopEnabled) return;
        if (getWindowScrollTop() > 280) btn.classList.add('is-visible');
        else btn.classList.remove('is-visible');
    }

    function updateBackToTop(path) {
        var btn = document.getElementById('back-to-top-btn');
        if (!btn) return;
        backToTopEnabled = !!BACK_TO_TOP_ROUTES[path];
        if (!backToTopEnabled) {
            btn.hidden = true;
            btn.classList.remove('is-visible');
            return;
        }
        btn.hidden = false;
        syncBackToTopVisibility();
    }

    function wireBackToTop() {
        var btn = document.getElementById('back-to-top-btn');
        if (!btn || btn.dataset.spaBackToTopWired === '1') return;
        btn.dataset.spaBackToTopWired = '1';

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var bodyEl = document.getElementById('app-body');
            try {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (err) {
                window.scrollTo(0, 0);
            }
            if (bodyEl) {
                try {
                    bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
                } catch (err2) {
                    bodyEl.scrollTop = 0;
                }
            }
            document.documentElement.scrollTop = 0;
        });

        var onScroll = function () { syncBackToTopVisibility(); };
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('scroll', onScroll, { passive: true, capture: true });
        window.addEventListener('resize', onScroll);
        var bodyEl = document.getElementById('app-body');
        if (bodyEl) bodyEl.addEventListener('scroll', onScroll, { passive: true });
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
        if (isNavigating) {
            queuedPath = path;
            return;
        }
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
            var htmlPromise = loadPageHtml(routeConfig.page);
            var isFirstBoot = !window.__usertypoBootAwaited;
            var bootTypingPromise = isFirstBoot && typeof window.usertypoAwaitBootTyping === 'function'
                ? window.usertypoAwaitBootTyping()
                : Promise.resolve();
            window.__usertypoBootAwaited = true;

            var html = await htmlPromise;
            await ensureRouteScripts(path);

            // Post-auth welcome (new / back) — overlay stays until page ready
            var welcomePhrase = null;
            if (path === '/' && typeof window.usertypoTakeAuthWelcomePhrase === 'function') {
                welcomePhrase = window.usertypoTakeAuthWelcomePhrase();
            }
            if (welcomePhrase && typeof window.usertypoPlayBootTyping === 'function') {
                // Play welcome while page assets continue; wait for typing to finish before reveal
                var welcomeTyping = window.usertypoPlayBootTyping(welcomePhrase);
                await Promise.all([bootTypingPromise, welcomeTyping]);
            } else {
                await bootTypingPromise;
            }

            var parsed = parseFragment(html);
            injectPageStyles(parsed.styles, path);
            container.innerHTML = parsed.content;
            if (typeof window.usertypoRevealLogos === 'function') {
                window.usertypoRevealLogos(container);
            }
            restartAnimations(spaContent || container);

            // Always re-execute page scripts on every visit
            if (parsed.scripts.length) {
                await executeScripts(parsed.scripts, path);
            }

            document.title = routeConfig.title;
            updateDocumentSeo(path, routeConfig);
            updateNavActive(routeConfig.navId);
            updateShellFooter(routeConfig);
            updateShellHeader(routeConfig);
            updateShellLayout(routeConfig);
            window.scrollTo(0, 0);
            updateBackToTop(path);

            if (typeof window.__spaPageInit === 'function') {
                try { await Promise.resolve(window.__spaPageInit()); } catch (e) { console.warn('__spaPageInit', e); }
            }

            if (path === '/settings' && window.usertypo_settingsApi && typeof window.usertypo_settingsApi.initSettingsPage === 'function') {
                try { window.usertypo_settingsApi.initSettingsPage(); } catch (e) { console.warn('initSettingsPage', e); }
            }

            reinitializeSharedModules(path);

            if (path === '/') {
                prepareHomeTypingView();
                if (typeof window.restartTest === 'function') {
                    try {
                        window.restartTest({ randomizeTheme: false });
                    } catch (e) { console.warn('restartTest', e); }
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
            if (typeof window.usertypoMarkAssetBootSuccessful === 'function') {
                window.usertypoMarkAssetBootSuccessful();
            }

            if (window.usertypoAnalytics && typeof window.usertypoAnalytics.trackPageView === 'function') {
                try { window.usertypoAnalytics.trackPageView(); } catch (e) { /* ignore */ }
            }

            // Let the first paint of page content settle behind the overlay
            await new Promise(function (resolve) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(resolve);
                });
            });
            if (document.fonts && document.fonts.ready) {
                try { await document.fonts.ready; } catch (e) { /* ignore */ }
            }
        } catch (err) {
            console.error('SPA load failed:', err);
            container.innerHTML = '<div class="p-12 text-red-400">Failed to load page.</div>';
        } finally {
            if (typeof window.usertypoDismissBootOverlay === 'function') {
                window.usertypoDismissBootOverlay();
            }
        }

        isNavigating = false;
        if (queuedPath) {
            var nextPath = queuedPath;
            queuedPath = null;
            loadRoute(nextPath);
        }
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
        wireBackToTop();
        var loc = parseRouteFromLocation();
        if (!routes[loc.path]) {
            history.replaceState({ spa: true, path: '/' }, '', '/');
            loadRoute('/');
        } else {
            loadRoute(loc.path);
        }
    });
})();
