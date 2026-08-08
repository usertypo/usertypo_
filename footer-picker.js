/**
 * Footer theme & language picker — panel below header, no backdrop dimming.
 */
(function () {
    'use strict';

    const VIEW_HOME = 'home';
    const VIEW_DARK = 'dark-themes';
    const VIEW_LIGHT = 'light-themes';
    const VIEW_CUSTOM = 'custom-themes';
    const VIEW_TEST_LANG = 'test-languages';

    const BLINK_MS = 130;
    const DEFAULT_DARK = 'Abyss';
    const DEFAULT_LIGHT = 'Paper';

    let currentView = VIEW_HOME;
    let isOpen = false;
    let searchQuery = '';
    let isTransitioning = false;

    function getPalettes() {
        return window.usertypo_THEME_PALETTES || {};
    }

    function getSettingsApi() {
        return window.usertypo_settingsApi || {};
    }

    function loadSettings() {
        const api = getSettingsApi();
        return api.loadSettings ? api.loadSettings() : {};
    }

    function isLightTheme(themeName) {
        const api = getSettingsApi();
        if (api.isThemeLight) return !!api.isThemeLight(themeName);
        const p = getPalettes()[themeName];
        if (!p?.bgMain) return false;
        const hex = p.bgMain.replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.55;
    }

    function getThemeNames() {
        // Built-in themes only — custom presets live in the Custom tab
        return Object.keys(getPalettes());
    }

    function getThemeLabel(themeName) {
        const api = getSettingsApi();
        if (api.getThemeDisplayName) return api.getThemeDisplayName(themeName);
        return themeName;
    }

    function getDarkThemes() {
        return getThemeNames().filter(name => !isLightTheme(name));
    }

    function getLightThemes() {
        return getThemeNames().filter(name => isLightTheme(name));
    }

    function getLanguages() {
        if (typeof window.getSettingsPageLanguages === 'function') {
            return window.getSettingsPageLanguages();
        }
        if (typeof ALL_LANGUAGES !== 'undefined' && Array.isArray(ALL_LANGUAGES)) {
            return ALL_LANGUAGES;
        }
        return [];
    }

    function getCustomPresets() {
        const settings = loadSettings();
        return Array.isArray(settings.lookFeel?.customPresets)
            ? settings.lookFeel.customPresets
            : [];
    }

    function getLanguageDisplayName(langFile) {
        const api = getSettingsApi();
        if (api.getLanguageDisplayName) return api.getLanguageDisplayName(langFile);
        const found = getLanguages().find(l => l.file === langFile);
        return found ? found.name : langFile;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function injectStyles() {
        let style = document.getElementById('footer-picker-css');
        if (!style) {
            style = document.createElement('style');
            style.id = 'footer-picker-css';
            document.head.appendChild(style);
        }
        style.textContent = `
            .footer-picker-overlay {
                position: fixed;
                inset: 0;
                z-index: 220;
                pointer-events: none;
                background: transparent;
                visibility: hidden;
            }
            .footer-picker-overlay.is-open {
                pointer-events: auto;
                visibility: visible;
            }
            #footer-picker-box {
                position: fixed;
                left: 50%;
                transform: translateX(-50%) scale(0.98);
                width: min(calc(100vw - 2rem), 28rem);
                max-height: min(calc(100vh - 6rem), 36rem);
                border-radius: 1.375rem;
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease, transform 0.2s ease;
            }
            .footer-picker-overlay.is-open #footer-picker-box {
                opacity: 1;
                transform: translateX(-50%) scale(1);
                pointer-events: auto;
            }
            .footer-picker-body {
                padding: 1.1rem 1.1rem 1rem;
                display: flex;
                flex-direction: column;
                gap: 0.45rem;
                min-height: 0;
                flex: 1;
            }
            .footer-picker-viewport {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
                min-height: 0;
                flex: 1;
                opacity: 1;
                transition: opacity ${BLINK_MS}ms ease;
            }
            .footer-picker-viewport.is-blinking {
                opacity: 0;
            }
            .footer-picker-search-wrap {
                display: flex;
                flex-direction: column;
                gap: 0.3rem;
                flex-shrink: 0;
            }
            .footer-picker-top-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
                min-height: 1.25rem;
            }
            .footer-picker-top-bar[hidden] {
                display: none !important;
            }
            .footer-picker-back {
                display: flex;
                align-items: center;
                gap: 0.35rem;
                border: none;
                background: transparent;
                color: #94a3b8;
                cursor: pointer;
                padding: 0 0.15rem;
                font-size: 0.65rem;
                font-family: "Roboto Mono", monospace;
                width: fit-content;
            }
            .footer-picker-back:hover { color: #fff; }
            .footer-picker-back .material-symbols-outlined { font-size: 1rem; }
            .footer-picker-close-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 1.6rem;
                height: 1.6rem;
                border: none;
                background: transparent;
                color: #64748b;
                cursor: pointer;
                padding: 0;
                margin-left: auto;
                border-radius: 9999px;
            }
            .footer-picker-close-btn:hover { color: #fff; }
            .footer-picker-close-btn .material-symbols-outlined { font-size: 1rem; }
            .footer-picker-search-row {
                position: relative;
            }
            .footer-picker-search-row[hidden] {
                display: none !important;
            }
            .footer-picker-search {
                width: 100%;
                border-radius: var(--theme-box-radius, 1.375rem);
                border: 1px solid rgba(255, 255, 255, 0.08);
                padding: 0.55rem 2.4rem 0.55rem 1rem;
                font-size: 0.72rem;
                font-family: "Roboto Mono", monospace;
                color: #e2e8f0;
                outline: none;
            }
            .footer-picker-search:focus {
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.35);
                outline: none !important;
                box-shadow: 0 0 10px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.12 * var(--glow-intensity, 1))) !important;
                --tw-ring-shadow: 0 0 transparent !important;
            }
            .footer-picker-end-icon {
                position: absolute;
                right: 0.55rem;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                align-items: center;
                justify-content: center;
                width: 1.6rem;
                height: 1.6rem;
                border: none;
                background: transparent;
                color: #64748b;
                cursor: default;
                padding: 0;
            }
            .footer-picker-end-icon.is-close {
                cursor: pointer;
            }
            .footer-picker-end-icon.is-close:hover { color: #fff; }
            .footer-picker-end-icon .material-symbols-outlined { font-size: 1rem; }
            .footer-picker-section-title {
                font-size: 0.58rem;
                font-weight: 700;
                letter-spacing: 0.14em;
                text-transform: uppercase;
                color: #64748b;
                margin: 0 0 0.75rem;
            }
            .footer-picker-themes-block {
                display: flex;
                flex-direction: column;
                gap: 1rem;
            }
            .footer-picker-themes-block > .footer-picker-section-title {
                margin-bottom: 0;
            }
            .footer-picker-theme-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 1rem;
            }
            .footer-picker-theme-preview {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 0.6rem;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: var(--theme-box-radius, 1.375rem);
                padding: 0.65rem;
                cursor: pointer;
                text-align: left;
                transition: border-color 0.15s ease, box-shadow 0.15s ease;
            }
            .footer-picker-theme-preview:hover {
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.35);
                box-shadow: 0 0 10px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.12 * var(--glow-intensity, 1)));
            }
            .fp-index-preview {
                border-radius: 0.625rem;
                overflow: hidden;
                padding: 0.45rem 0.5rem 0.55rem;
                min-height: 4.6rem;
                display: flex;
                flex-direction: column;
                gap: 0.45rem;
            }
            .fp-preview-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.25rem;
                min-height: 0.85rem;
            }
            .fp-preview-circle {
                width: 0.42rem;
                height: 0.42rem;
                border-radius: 9999px;
                border: 1px solid;
                flex-shrink: 0;
                opacity: 0.55;
            }
            .fp-preview-logo-wrap {
                flex: 1;
                display: flex;
                justify-content: center;
                align-items: center;
                min-width: 0;
            }
            .fp-preview-logo-box {
                position: relative;
                width: 8.8rem;
                height: 2.0rem;
                overflow: visible;
            }
            .fp-preview-logo-layer {
                position: absolute;
                inset: 0;
                -webkit-mask-size: contain;
                mask-size: contain;
                -webkit-mask-repeat: no-repeat;
                mask-repeat: no-repeat;
                -webkit-mask-position: center;
                mask-position: center;
            }
            .fp-preview-logo-typ {
                z-index: 1;
                -webkit-mask-image: url('logo-assets/typ_.png');
                mask-image: url('logo-assets/typ_.png');
            }
            .fp-preview-logo-user {
                z-index: 2;
                -webkit-mask-image: url('logo-assets/user.png');
                mask-image: url('logo-assets/user.png');
            }
            .fp-preview-logo-o {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                object-fit: contain;
                z-index: 3;
                pointer-events: none;
            }
            .fp-preview-lines {
                display: flex;
                flex-direction: column;
                gap: 0.28rem;
                padding: 0.1rem 0.05rem 0;
            }
            .fp-preview-line {
                height: 0.16rem;
                border-radius: 9999px;
            }
            .fp-preview-line-row {
                display: flex;
                align-items: center;
                gap: 0.18rem;
                margin-top: 0.05rem;
            }
            .fp-preview-block {
                height: 0.16rem;
                border-radius: 0.08rem;
                flex-shrink: 0;
            }
            .fp-preview-caret {
                width: 1px;
                height: 0.42rem;
                border-radius: 1px;
                flex-shrink: 0;
            }
            .footer-picker-preview-label {
                font-size: 0.65rem;
                font-weight: 700;
                color: #cbd5e1;
            }
            .footer-picker-preview-sub {
                font-size: 0.58rem;
                color: #64748b;
            }
            .footer-picker-pill {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: var(--theme-box-radius, 1.375rem);
                padding: 0.65rem 1rem;
                font-size: 0.68rem;
                font-family: "Roboto Mono", monospace;
                color: #cbd5e1;
                cursor: pointer;
                text-align: left;
                transition: color 0.15s ease, border-color 0.15s ease;
            }
            .footer-picker-pill:hover:not(:disabled) {
                color: #fff;
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.3);
            }
            .footer-picker-pill:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }
            .footer-picker-pill .material-symbols-outlined {
                font-size: 0.95rem;
                color: #64748b;
            }
            .footer-picker-lang-stack {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }
            .footer-picker-divider {
                height: 1px;
                background: rgba(255, 255, 255, 0.08);
                flex-shrink: 0;
                margin: 0.15rem 0;
            }
            .footer-picker-list-title {
                font-size: 0.62rem;
                font-weight: 700;
                color: #94a3b8;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                margin: 0 0 0.2rem;
            }
            .footer-picker-list-scroll {
                overflow-y: auto;
                min-height: 0;
                max-height: min(15rem, calc(100vh - 18rem));
                padding-right: 0.2rem;
                margin-top: 0;
            }
            .footer-picker-list-scroll::-webkit-scrollbar { width: 4px; }
            .footer-picker-list-scroll::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.12);
                border-radius: 9999px;
            }
            .footer-picker-list-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 0.6rem;
            }
            .footer-picker-list-item {
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: var(--theme-box-radius, 1.375rem);
                padding: 0.45rem 0.65rem;
                font-size: 0.6rem;
                font-family: "Roboto Mono", monospace;
                color: #94a3b8;
                cursor: pointer;
                text-align: center;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                transition: color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
            }
            .footer-picker-list-item:hover {
                color: #fff;
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.3);
            }
            .footer-picker-list-item.is-active {
                color: var(--theme-primary, #00d0ff);
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.45);
                box-shadow: 0 0 8px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.2 * var(--glow-intensity, 1)));
            }
            .footer-picker-empty {
                font-size: 0.62rem;
                color: #64748b;
                text-align: center;
                padding: 1.25rem 0.5rem;
                line-height: 1.55;
            }
            .footer-picker-empty a,
            .footer-picker-settings-link {
                color: var(--theme-primary, #00d0ff);
                text-decoration: underline;
                text-underline-offset: 2px;
                cursor: pointer;
                font-weight: 700;
                background: none;
                border: none;
                padding: 0;
                font: inherit;
            }
            .footer-picker-empty a:hover,
            .footer-picker-settings-link:hover {
                filter: brightness(1.15);
            }
            .footer-picker-search-results {
                display: flex;
                flex-direction: column;
                gap: 1rem;
                min-height: 0;
                flex: 1;
            }
        `;
    }

    function buildIndexPreview(themeName) {
        const p = getPalettes()[themeName] || getPalettes()['usertypo_'];
        if (!p) return '';
        return `
            <div class="fp-index-preview" style="background:${p.bgMain}">
                <div class="fp-preview-header">
                    <div class="fp-preview-circle" style="border-color:${p.textMuted}"></div>
                    <div class="fp-preview-logo-wrap">
                        <div class="fp-preview-logo-box">
                            <div class="fp-preview-logo-layer fp-preview-logo-typ" style="background:${p.accentPrimary}"></div>
                            <div class="fp-preview-logo-layer fp-preview-logo-user" style="background:${p.textPrimary}"></div>
                            <img src="logo-assets/o.png" class="fp-preview-logo-o" alt="">
                        </div>
                    </div>
                    <div class="fp-preview-circle" style="border-color:${p.textMuted}"></div>
                </div>
                <div class="fp-preview-lines">
                    <div class="fp-preview-line" style="background:${p.textMuted};opacity:0.28;width:88%"></div>
                    <div class="fp-preview-line" style="background:${p.textMuted};opacity:0.22;width:70%"></div>
                    <div class="fp-preview-line-row">
                        <div class="fp-preview-block" style="background:${p.textPrimary};opacity:0.55;width:1.1rem"></div>
                        <div class="fp-preview-block" style="background:${p.textMuted};opacity:0.35;width:0.85rem"></div>
                        <div class="fp-preview-block" style="background:${p.textMuted};opacity:0.25;width:0.65rem"></div>
                        <div class="fp-preview-caret" style="background:${p.accentPrimary}"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function positionPickerBox() {
        const box = document.getElementById('footer-picker-box');
        const header = document.querySelector('header');
        if (!box) return;
        // Fixed viewport anchor — do not use getBoundingClientRect (breaks when scrolled)
        const topGap = 14;
        const top = header ? header.offsetHeight + topGap : 72;
        box.style.top = `${top}px`;
    }

    function injectModal() {
        let overlay = document.getElementById('footer-picker-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'footer-picker-overlay';
            overlay.className = 'footer-picker-overlay';
            document.body.appendChild(overlay);
        }

        // Always refresh markup so layout fixes apply after code updates
        overlay.innerHTML = `
            <div id="footer-picker-box" class="glass-panel bg-surface/85 !backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Themes and Languages">
                <div class="footer-picker-body">
                    <div class="footer-picker-search-wrap" id="footer-picker-search-wrap">
                        <div class="footer-picker-top-bar" id="footer-picker-top-bar" hidden>
                            <button type="button" class="footer-picker-back" id="footer-picker-back" aria-label="Back">
                                <span class="material-symbols-outlined">arrow_back</span>
                                <span>Back</span>
                            </button>
                            <button type="button" class="footer-picker-close-btn" id="footer-picker-close" aria-label="Close">
                                <span class="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        <div class="footer-picker-search-row" id="footer-picker-search-row">
                            <input type="text" class="footer-picker-search glass-panel bg-surface/85 !backdrop-blur-sm" id="footer-picker-search" placeholder="Search themes & languages..." autocomplete="off" />
                            <span class="footer-picker-end-icon" id="footer-picker-end-icon" aria-hidden="true">
                                <span class="material-symbols-outlined">search</span>
                            </span>
                        </div>
                    </div>
                    <div class="footer-picker-viewport" id="footer-picker-viewport"></div>
                </div>
            </div>
        `;

        if (!overlay.dataset.fpWired) {
            overlay.dataset.fpWired = '1';
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closePicker();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && isOpen) closePicker();
            });
            window.addEventListener('resize', () => {
                if (isOpen) positionPickerBox();
            });
        }

        const box = document.getElementById('footer-picker-box');
        if (box && !box.dataset.fpWired) {
            box.dataset.fpWired = '1';
            box.addEventListener('click', (e) => e.stopPropagation());
        }

        const back = document.getElementById('footer-picker-back');
        const closeBtn = document.getElementById('footer-picker-close');
        const input = document.getElementById('footer-picker-search');

        if (back) {
            back.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                goBack();
            };
        }
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                closePicker();
            };
        }
        if (input) {
            input.oninput = () => {
                searchQuery = input.value;
                renderViewContent(currentView);
            };
            ['keydown', 'keyup', 'keypress'].forEach((type) => {
                input.addEventListener(type, (e) => e.stopPropagation());
            });
            input.addEventListener('mousedown', (e) => e.stopPropagation());
        }
    }

    function updateSearchChrome() {
        const isSub = currentView !== VIEW_HOME;
        const topBar = document.getElementById('footer-picker-top-bar');
        const searchRow = document.getElementById('footer-picker-search-row');
        const input = document.getElementById('footer-picker-search');

        if (topBar) topBar.hidden = !isSub;
        if (searchRow) searchRow.hidden = isSub;

        if (input) {
            if (isSub) {
                searchQuery = '';
                input.value = '';
            } else if (document.activeElement !== input) {
                input.placeholder = 'Search themes & languages...';
            }
        }
    }

    function goBack() {
        if (currentView === VIEW_HOME || isTransitioning) return;
        transitionToView(VIEW_HOME);
    }

    function matchesQuery(text, q) {
        if (!q) return true;
        return String(text || '').toLowerCase().includes(q);
    }

    function renderListGrid(itemsHtml) {
        return `
            <div class="footer-picker-list-scroll">
                ${itemsHtml
                ? `<div class="footer-picker-list-grid">${itemsHtml}</div>`
                : `<p class="footer-picker-empty">No results</p>`}
            </div>
        `;
    }

    function renderHomeSearchResults(q) {
        const viewport = document.getElementById('footer-picker-viewport');
        if (!viewport) return;
        const ql = q.toLowerCase().trim();
        const currentTheme = loadSettings().lookFeel?.colorTheme || getPreferredDefaultThemeSafe();
        const currentLang = loadSettings().languageContent?.testLanguage || 'english';

        const darkHits = getDarkThemes().filter(n =>
            matchesQuery(n, ql) || matchesQuery(getThemeLabel(n), ql));
        const lightHits = getLightThemes().filter(n =>
            matchesQuery(n, ql) || matchesQuery(getThemeLabel(n), ql));
        const themeHits = [...darkHits, ...lightHits];

        const presets = getCustomPresets();
        const customHits = presets
            .map((p, i) => ({
                id: `custom:${i}`,
                label: p.name || `Custom ${i + 1}`,
                mode: p.mode || 'Dark',
            }))
            .filter(item => matchesQuery(item.label, ql) || matchesQuery(item.mode, ql));

        const langHits = getLanguages().filter(l =>
            matchesQuery(l.name, ql) || matchesQuery(l.file, ql));

        const themeHtml = themeHits.map(name => `
            <button type="button" class="footer-picker-list-item glass-panel bg-surface/85 !backdrop-blur-sm${name === currentTheme ? ' is-active' : ''}" data-theme="${escapeAttr(name)}">${escapeHtml(getThemeLabel(name))}</button>
        `).join('');

        const customHtml = customHits.map(item => `
            <button type="button" class="footer-picker-list-item glass-panel bg-surface/85 !backdrop-blur-sm${item.id === currentTheme ? ' is-active' : ''}" data-theme="${escapeAttr(item.id)}">${escapeHtml(item.label)}</button>
        `).join('');

        const langHtml = langHits.map(l => `
            <button type="button" class="footer-picker-list-item glass-panel bg-surface/85 !backdrop-blur-sm${l.file === currentLang ? ' is-active' : ''}" data-lang="${escapeAttr(l.file)}">${escapeHtml(l.name)}</button>
        `).join('');

        const hasAny = themeHits.length || customHits.length || langHits.length;

        viewport.innerHTML = `
            <div class="footer-picker-search-results">
                ${!hasAny ? `<p class="footer-picker-empty">No themes or languages match “${escapeHtml(q)}”</p>` : ''}
                ${themeHits.length ? `
                    <div>
                        <p class="footer-picker-list-title">Themes</p>
                        ${renderListGrid(themeHtml)}
                    </div>
                ` : ''}
                ${customHits.length ? `
                    <div>
                        <p class="footer-picker-list-title">Custom Themes</p>
                        ${renderListGrid(customHtml)}
                    </div>
                ` : ''}
                ${langHits.length ? `
                    <div>
                        <p class="footer-picker-list-title">Languages</p>
                        ${renderListGrid(langHtml)}
                    </div>
                ` : ''}
            </div>
        `;

        viewport.querySelectorAll('[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => selectTheme(btn.dataset.theme));
        });
        viewport.querySelectorAll('[data-lang]').forEach(btn => {
            btn.addEventListener('click', () => selectLanguage(btn.dataset.lang));
        });
    }

    function getPreferredDefaultThemeSafe() {
        const api = getSettingsApi();
        if (api.getPreferredDefaultTheme) return api.getPreferredDefaultTheme();
        try {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                return DEFAULT_LIGHT;
            }
        } catch (e) { /* ignore */ }
        return DEFAULT_DARK;
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
        return escapeHtml(str).replace(/'/g, '&#39;');
    }

    function renderHome() {
        const viewport = document.getElementById('footer-picker-viewport');
        if (!viewport) return;

        if (searchQuery.trim()) {
            renderHomeSearchResults(searchQuery);
            return;
        }

        viewport.innerHTML = `
            <div class="footer-picker-themes-block">
                <p class="footer-picker-section-title">Themes</p>
                <div class="footer-picker-theme-row">
                    <button type="button" class="footer-picker-theme-preview glass-panel bg-surface/85 !backdrop-blur-sm" data-go-view="${VIEW_DARK}">
                        ${buildIndexPreview(DEFAULT_DARK)}
                        <span class="footer-picker-preview-label">Dark</span>
                    </button>
                    <button type="button" class="footer-picker-theme-preview glass-panel bg-surface/85 !backdrop-blur-sm" data-go-view="${VIEW_LIGHT}">
                        ${buildIndexPreview(DEFAULT_LIGHT)}
                        <span class="footer-picker-preview-label">Light</span>
                    </button>
                </div>
                <button type="button" class="footer-picker-pill glass-panel bg-surface/85 !backdrop-blur-sm" data-go-view="custom-themes">
                    <span>Custom Theme</span>
                    <span class="material-symbols-outlined">chevron_right</span>
                </button>
            </div>
            <div class="footer-picker-divider"></div>
            <div>
                <p class="footer-picker-section-title">Languages</p>
                <div class="footer-picker-lang-stack">
                    <button type="button" class="footer-picker-pill glass-panel bg-surface/85 !backdrop-blur-sm" data-go-view="${VIEW_TEST_LANG}">
                        <span>Test Languages</span>
                        <span class="material-symbols-outlined">chevron_right</span>
                    </button>
                    <button type="button" class="footer-picker-pill glass-panel bg-surface/85 !backdrop-blur-sm" disabled>
                        <span>UI Languages</span>
                        <span class="material-symbols-outlined">chevron_right</span>
                    </button>
                </div>
            </div>
        `;
        bindNavigation(viewport);
    }

    function renderThemeList(kind) {
        const viewport = document.getElementById('footer-picker-viewport');
        if (!viewport) return;
        const themes = kind === 'light' ? getLightThemes() : getDarkThemes();
        const current = loadSettings().lookFeel?.colorTheme || getPreferredDefaultThemeSafe();
        const title = kind === 'light' ? 'Light Themes' : 'Dark Themes';

        const itemsHtml = themes.map(name => `
            <button type="button" class="footer-picker-list-item glass-panel bg-surface/85 !backdrop-blur-sm${name === current ? ' is-active' : ''}" data-theme="${escapeAttr(name)}">${escapeHtml(getThemeLabel(name))}</button>
        `).join('');

        viewport.innerHTML = `
            <p class="footer-picker-list-title">${title}</p>
            ${renderListGrid(itemsHtml)}
        `;

        viewport.querySelectorAll('[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => selectTheme(btn.dataset.theme));
        });
    }

    function renderLanguageList() {
        const viewport = document.getElementById('footer-picker-viewport');
        if (!viewport) return;
        const langs = getLanguages();
        const current = loadSettings().languageContent?.testLanguage || 'english';

        const itemsHtml = langs.map(l => `
            <button type="button" class="footer-picker-list-item glass-panel bg-surface/85 !backdrop-blur-sm${l.file === current ? ' is-active' : ''}" data-lang="${escapeAttr(l.file)}">${escapeHtml(l.name)}</button>
        `).join('');

        viewport.innerHTML = `
            <p class="footer-picker-list-title">Test Languages</p>
            ${langs.length
                ? renderListGrid(itemsHtml)
                : `<p class="footer-picker-empty">Language list unavailable</p>`}
        `;

        viewport.querySelectorAll('[data-lang]').forEach(btn => {
            btn.addEventListener('click', () => selectLanguage(btn.dataset.lang));
        });
    }

    function bindNavigation(root) {
        root.querySelectorAll('[data-go-view]').forEach(btn => {
            btn.addEventListener('click', () => transitionToView(btn.dataset.goView));
        });
    }

    function openCustomThemeSettings() {
        closePicker();
        try {
            sessionStorage.setItem('usertypo_settings_open', JSON.stringify({
                category: 'look-feel',
                subSetting: 'Theme',
                nestedSub: 'Custom Theme',
            }));
        } catch (e) { /* ignore */ }

        // Already on settings — open panels directly
        if (document.getElementById('settings-container')
            && typeof window.navigateToSetting === 'function') {
            try {
                window.navigateToSetting('look-feel', 'Theme');
                window.setTimeout(function () {
                    try {
                        var nested = document.querySelector(
                            '.settings-panel-card:not(#panel-card) [data-sub-title="Custom Theme"] .sub-card-header'
                        );
                        if (nested && typeof window.openSubSetting === 'function') {
                            window.openSubSetting(nested);
                        }
                    } catch (err) { /* ignore */ }
                }, 200);
                return;
            } catch (e) { /* fall through to navigate */ }
        }

        if (typeof window.navigateTo === 'function') {
            window.navigateTo('/settings');
            return;
        }
        window.location.assign('/settings');
    }

    function renderCustomThemes() {
        const viewport = document.getElementById('footer-picker-viewport');
        if (!viewport) return;
        const settings = loadSettings();
        const presets = getCustomPresets();
        const current = settings.lookFeel?.colorTheme || getPreferredDefaultThemeSafe();

        if (!presets.length) {
            viewport.innerHTML = `
                <p class="footer-picker-list-title">Custom Themes</p>
                <p class="footer-picker-empty">
                    No custom themes created. You can create one on
                    <button type="button" class="footer-picker-settings-link" data-open-custom-theme>Settings</button>
                </p>
            `;
            const link = viewport.querySelector('[data-open-custom-theme]');
            if (link) {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openCustomThemeSettings();
                });
            }
            return;
        }

        const itemsHtml = presets.map((p, i) => {
            const id = `custom:${i}`;
            const label = p.name || `Custom ${i + 1}`;
            return `
                <button type="button" class="footer-picker-list-item glass-panel bg-surface/85 !backdrop-blur-sm${id === current ? ' is-active' : ''}" data-theme="${escapeAttr(id)}" title="${escapeAttr((p.mode || 'Dark') + ' · ' + (p.mainColor || ''))}">
                    ${escapeHtml(label)}
                </button>
            `;
        }).join('');

        viewport.innerHTML = `
            <p class="footer-picker-list-title">Custom Themes</p>
            ${renderListGrid(itemsHtml)}
        `;

        viewport.querySelectorAll('[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => selectTheme(btn.dataset.theme));
        });
    }

    function renderViewContent(view) {
        if (view === VIEW_HOME) renderHome();
        else if (view === VIEW_DARK) renderThemeList('dark');
        else if (view === VIEW_LIGHT) renderThemeList('light');
        else if (view === VIEW_CUSTOM) renderCustomThemes();
        else if (view === VIEW_TEST_LANG) renderLanguageList();
    }

    function renderView(view, preserveSearch) {
        currentView = view;
        if (!preserveSearch && view === VIEW_HOME) searchQuery = '';
        updateSearchChrome();
        const input = document.getElementById('footer-picker-search');
        if (input) {
            if (!preserveSearch && view === VIEW_HOME) input.value = '';
            else input.value = searchQuery;
        }
        renderViewContent(view);
    }

    async function transitionToView(view) {
        if (isTransitioning) return;
        if (view === currentView) return;
        isTransitioning = true;
        const viewport = document.getElementById('footer-picker-viewport');
        if (viewport) viewport.classList.add('is-blinking');
        await sleep(BLINK_MS);
        if (view === VIEW_HOME) searchQuery = '';
        renderView(view, view !== VIEW_HOME);
        if (viewport) viewport.classList.remove('is-blinking');
        isTransitioning = false;
    }

    function selectTheme(themeName) {
        const api = getSettingsApi();
        if (api.selectColorTheme) {
            api.selectColorTheme(themeName);
        } else {
            const settings = loadSettings();
            if (api.setByPath && api.saveSettings) {
                api.setByPath(settings, 'lookFeel.colorTheme', themeName);
                api.saveSettings(settings);
                if (api.applyAllSettings) api.applyAllSettings(settings);
            }
        }
        // Keep settings page theme buttons / labels in sync when that page is open
        if (api.syncColorThemeSelectLabel) {
            try { api.syncColorThemeSelectLabel(loadSettings()); } catch (e) { /* ignore */ }
        }
        renderViewContent(currentView);
    }

    function selectLanguage(langFile) {
        if (typeof saveLanguage === 'function') {
            saveLanguage(langFile);
        } else {
            const api = getSettingsApi();
            const settings = loadSettings();
            if (!settings.languageContent) settings.languageContent = {};
            settings.languageContent.testLanguage = langFile;
            if (api.saveSettings) api.saveSettings(settings);
        }

        if (typeof window._initLang === 'function') {
            const testActive = typeof window.usertypo_testRuntime?.isActive === 'function'
                && window.usertypo_testRuntime.isActive();
            window._initLang({ skipRestart: testActive });
        }

        const api = getSettingsApi();
        if (api.applyFooterSettings) api.applyFooterSettings();

        // Sync Settings → Test Language UI if that page is mounted
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-lang-file') === langFile);
        });
        const displayName = getLanguageDisplayName(langFile);
        document.querySelectorAll('[data-sub-title="Test Language"]').forEach((card) => {
            const label = card.querySelector('.setting-select .truncate');
            if (label) label.textContent = displayName;
        });

        renderViewContent(currentView);
    }

    function openPicker() {
        if (!document.querySelector('[data-footer-picker]')) return;
        if (isOpen) {
            closePicker();
            return;
        }
        injectStyles();
        injectModal();
        isOpen = true;
        currentView = VIEW_HOME;
        searchQuery = '';
        const overlay = document.getElementById('footer-picker-overlay');
        renderView(VIEW_HOME);
        positionPickerBox();
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        const input = document.getElementById('footer-picker-search');
        if (input) setTimeout(() => input.focus(), 80);
    }

    function closePicker() {
        isOpen = false;
        const overlay = document.getElementById('footer-picker-overlay');
        if (overlay) {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
        }
        // Drop focus from any control inside the closed picker
        const active = document.activeElement;
        if (active && overlay && overlay.contains(active) && typeof active.blur === 'function') {
            active.blur();
        }
        currentView = VIEW_HOME;
        searchQuery = '';
        isTransitioning = false;
        const input = document.getElementById('footer-picker-search');
        if (input) input.value = '';
    }

    function initFooterPicker() {
        injectStyles();
        document.querySelectorAll('[data-footer-picker]').forEach(btn => {
            if (btn.dataset.footerPickerBound) return;
            btn.dataset.footerPickerBound = '1';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openPicker();
            });
        });
    }

    window.usertypo_footerPicker = {
        open: openPicker,
        close: closePicker,
        init: initFooterPicker,
        isOpen: () => isOpen,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFooterPicker);
    } else {
        initFooterPicker();
    }
})();
