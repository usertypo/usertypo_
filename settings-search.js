/**
 * Quick Actions overlay — opens on Escape from any page.
 * Searches settings (reusing the settings page's inline controls), the home
 * test config bar / leaderboard filters (on those pages), and pages ("/" prefix).
 * The first result is selected; Enter runs its highlighted action.
 */
(function () {
    'use strict';

    const api = () => window.usertypo_settingsApi;
    let searchIndex = null;
    let indexDoc = null;
    let isOpen = false;
    let overlayEl = null;
    let searchInput = null;
    let searchClearBtn = null;
    let resultsPanel = null;
    let resultsContainer = null;
    let indexPromise = null;
    // Rendered results: [{ entry, el, target }]; target = element Enter will press
    let currentEntries = [];
    let selectedIndex = 0;
    let selectedSub = 0;
    let lastSearch = null; // promise of the in-flight search, so Enter acts on fresh results

    function injectStyles() {
        const existing = document.getElementById('global-settings-search-styles');
        if (existing) existing.remove();
        const style = document.createElement('style');
        style.id = 'global-settings-search-styles';
        style.textContent = `
            #global-settings-search-overlay {
                position: fixed;
                inset: 0;
                z-index: 300;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.25s ease;
                background: transparent;
            }
            #global-settings-search-overlay.open {
                pointer-events: none;
                opacity: 1;
            }
            #global-settings-search-overlay.open .gss-backdrop {
                pointer-events: auto;
            }
            #global-settings-search-overlay.open .gss-inner {
                pointer-events: auto;
            }
            #global-settings-search-overlay .gss-backdrop {
                position: fixed;
                inset: 0;
                background: transparent;
                pointer-events: none;
            }
            #global-settings-search-overlay .gss-inner {
                position: fixed;
                top: var(--gss-top, 5rem);
                left: 50%;
                z-index: 1;
                width: min(32.5rem, calc(100vw - 2rem));
                max-width: min(32.5rem, calc(100vw - 2rem));
                padding: 0 1rem;
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
                transform: translateX(-50%) translateY(-8px);
                transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                box-sizing: border-box;
            }
            #global-settings-search-overlay.open .gss-inner {
                transform: translateX(-50%) translateY(0);
            }
            #global-settings-search-overlay .search-area {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                flex-wrap: wrap;
            }
            #global-settings-search-overlay .search-wrapper {
                position: relative;
                flex: 1;
                max-width: min(26.25rem, calc(100vw - 8rem));
                border-radius: 9999px;
                padding: 0.15rem;
            }
            #global-settings-search-overlay .search-input {
                width: 100%;
                background: transparent;
                border: none;
                border-radius: 9999px;
                padding: 0.55rem 2.5rem;
                color: var(--theme-text, #cbd5e1);
                font-size: 0.75rem;
                font-family: 'Roboto Mono', monospace;
                outline: none;
                box-shadow: none;
            }
            #global-settings-search-overlay .search-input:focus,
            #global-settings-search-overlay .search-input:focus-visible {
                outline: none !important;
                border: none !important;
                box-shadow: none !important;
            }
            #global-settings-search-overlay .search-wrapper:focus-within {
                outline: none !important;
            }
            #global-settings-search-overlay .search-input::placeholder { color: #475569; }
            #global-settings-search-overlay .search-clear-btn {
                position: absolute;
                right: 0.625rem;
                top: 50%;
                transform: translateY(-50%);
                width: 1.25rem;
                height: 1.25rem;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 9999px;
                background: rgba(255,255,255,0.06);
                border: none;
                cursor: pointer;
                opacity: 0;
                pointer-events: none;
                transition: all 0.2s ease;
                color: #94a3b8;
            }
            #global-settings-search-overlay .search-clear-btn.visible {
                opacity: 1;
                pointer-events: auto;
            }
            #global-settings-search-overlay .search-clear-btn:hover {
                background: rgba(255,51,51,0.15);
                color: #ff6666;
            }
            #global-settings-search-overlay .quick-settings {
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }
            #global-settings-search-overlay .quick-btn {
                width: 2.25rem;
                height: 2.25rem;
                border-radius: 9999px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #64748b;
                cursor: pointer;
                transition: all 0.25s ease;
                position: relative;
                padding: 0;
            }
            #global-settings-search-overlay .quick-btn:hover {
                background: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.1);
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.3);
                color: var(--theme-primary, #00d0ff);
                box-shadow: 0 0 12px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.15 * var(--glow-intensity, 1)));
            }
            #global-settings-search-overlay .quick-btn .material-symbols-outlined { font-size: 1.125rem; }
            #global-settings-search-overlay .quick-btn-tooltip {
                position: absolute;
                bottom: calc(100% + 0.5rem);
                left: 50%;
                transform: translateX(-50%) translateY(0.25rem);
                padding: 0.25rem 0.625rem;
                border-radius: 0.5rem;
                background: var(--theme-menu-bg, rgba(68, 68, 68, 0.4));
                background-image: none;
                border: 1px solid rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                font-size: 0.625rem;
                font-weight: 600;
                color: #94a3b8;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: all 0.2s ease;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
            }
            #global-settings-search-overlay .quick-btn:hover .quick-btn-tooltip {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            #global-settings-search-overlay .gss-results-panel {
                display: none;
                position: relative;
                max-height: min(70vh, 560px);
                overflow: hidden;
                border-radius: 1rem;
                padding: 0;
                box-sizing: border-box;
            }
            #global-settings-search-overlay .gss-results-panel.active { display: block; }
            /* Equal pad on all sides. Native bar hidden so it can't steal right space. */
            #global-settings-search-overlay #global-settings-search-results {
                max-height: min(70vh, 560px);
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                padding: 0.75rem;
                scrollbar-width: none;
                -ms-overflow-style: none;
            }
            #global-settings-search-overlay #global-settings-search-results::-webkit-scrollbar {
                width: 0 !important;
                height: 0 !important;
                display: none !important;
            }
            /* Custom bar on the right edge; wide hit target, thin visual thumb */
            #global-settings-search-overlay .gss-scrollbar {
                position: absolute;
                top: 0.75rem;
                bottom: 0.75rem;
                right: 0;
                width: 12px;
                pointer-events: none;
                opacity: 0;
                z-index: 20;
                cursor: default;
            }
            #global-settings-search-overlay .gss-results-panel.has-scroll .gss-scrollbar {
                opacity: 1;
                pointer-events: auto;
            }
            #global-settings-search-overlay .gss-scrollbar-thumb {
                position: absolute;
                left: 4px;
                width: 4px;
                min-height: 1.25rem;
                border-radius: 4px;
                background: rgba(255,255,255,0.18);
                cursor: default;
                touch-action: none;
                transition: background 0.15s ease;
            }
            #global-settings-search-overlay .gss-scrollbar-thumb:hover {
                background: rgba(255,255,255,0.32);
            }
            #global-settings-search-overlay .gss-scrollbar-thumb:active {
                background: rgba(255,255,255,0.4);
            }
            #global-settings-search-overlay .search-result-item {
                border-radius: 0.75rem;
                padding: 0.75rem 1rem;
                margin-bottom: 0.5rem;
                position: relative;
                z-index: 1;
                overflow: visible;
            }
            #global-settings-search-overlay .search-result-item:last-child { margin-bottom: 0; }
            #global-settings-search-overlay .search-result-item:has(.custom-popover.is-open) {
                z-index: 40;
            }
            #global-settings-search-overlay .search-result-category {
                font-size: 0.625rem;
                font-weight: 700;
                color: var(--theme-primary, #00d0ff);
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-bottom: 0.125rem;
            }
            #global-settings-search-overlay .search-result-name {
                font-size: 0.8125rem;
                font-weight: 600;
                color: var(--theme-fg-strong, #e2e8f0);
                margin-bottom: 0.5rem;
            }
            #global-settings-search-overlay .search-result-desc {
                font-size: 0.6875rem;
                color: #64748b;
                margin-bottom: 0.5rem;
            }
            #global-settings-search-overlay .search-highlight {
                color: var(--theme-primary, #00d0ff);
                font-weight: 700;
            }
            #global-settings-search-overlay .search-result-controls {
                margin-top: 0.35rem;
                overflow: visible;
            }
            #global-settings-search-overlay .custom-popover-wrapper {
                position: relative !important;
                overflow: visible !important;
                z-index: 2;
            }
            /* Keep closed popovers fully out of the layout; open ones portal as fixed */
            #global-settings-search-overlay .custom-popover {
                display: none !important;
                width: 13.5rem !important;
                min-width: 13.5rem !important;
                max-width: none !important;
                background: var(--theme-menu-bg, rgba(68, 68, 68, 0.4)) !important;
                background-color: var(--theme-menu-bg, rgba(68, 68, 68, 0.4)) !important;
                background-image: none !important;
                backdrop-filter: blur(4px) !important;
                -webkit-backdrop-filter: blur(4px) !important;
                border: 1px solid rgba(255, 255, 255, 0.05) !important;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5) !important;
                opacity: 1 !important;
            }
            #global-settings-search-overlay .custom-popover.is-open {
                display: flex !important;
            }
            #global-settings-search-overlay .custom-popover.is-portaled {
                position: fixed !important;
                top: var(--popover-top, 0px) !important;
                left: var(--popover-left, 0px) !important;
                right: auto !important;
                bottom: auto !important;
                transform: none !important;
                margin: 0 !important;
                z-index: 120 !important;
            }
            #global-settings-search-overlay .custom-popover input,
            #global-settings-search-overlay .custom-popover > button {
                width: 100% !important;
                border-radius: 0.75rem !important;
            }
            #global-settings-search-overlay .toggle-track {
                width: 2.5rem; height: 1.375rem;
                background: rgba(255,255,255,0.08);
                border-radius: 9999px;
                position: relative;
                cursor: pointer;
                transition: background 0.25s ease;
                border: 1px solid rgba(255,255,255,0.1);
                flex-shrink: 0;
            }
            #global-settings-search-overlay .toggle-track.on {
                background: var(--theme-primary, #00d0ff);
                border-color: var(--theme-primary, #00d0ff);
                box-shadow: 0 0 8px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.4 * var(--glow-intensity, 1)));
            }
            #global-settings-search-overlay .toggle-thumb {
                position: absolute;
                top: 0.1875rem; left: 0.1875rem;
                width: 0.875rem; height: 0.875rem;
                background: rgba(170,185,200,0.7);
                border-radius: 9999px;
                transition: transform 0.25s cubic-bezier(0.16,1,0.3,1), background 0.25s ease;
            }
            #global-settings-search-overlay .toggle-track.on .toggle-thumb {
                transform: translateX(1.125rem);
                background: #ffffff;
                box-shadow: 0 0 6px rgba(255, 255, 255, calc(0.8 * var(--glow-intensity, 1)));
            }
            #global-settings-search-overlay .opt-btn {
                padding: 0.35rem 0.7rem;
                border-radius: 0.5rem;
                font-size: 0.65rem;
                font-weight: 600;
                font-family: 'Roboto Mono', monospace;
                border: 1px solid transparent;
                background: rgba(255,255,255,0.04);
                color: #94a3b8;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            #global-settings-search-overlay .opt-btn:hover { background: rgba(255,255,255,0.08); color: var(--theme-fg-strong, #fff); }
            #global-settings-search-overlay .opt-btn.active {
                background: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.15);
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.35);
                color: var(--theme-primary, #00d0ff);
                box-shadow: 0 0 8px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.15 * var(--glow-intensity, 1)));
            }
            #global-settings-search-overlay input[type="range"].custom-slider {
                -webkit-appearance: none;
                appearance: none;
                height: 24px !important;
                flex: 1;
                min-width: 0;
                background-color: transparent !important;
                background-image: linear-gradient(var(--theme-primary, #00d0ff), var(--theme-primary, #00d0ff)), linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)) !important;
                background-repeat: no-repeat !important;
                background-position: left center, left center !important;
                border-radius: 0 !important;
                outline: none;
                cursor: pointer;
            }
            #global-settings-search-overlay input[type="range"].custom-slider::-webkit-slider-runnable-track {
                -webkit-appearance: none;
                height: 4px;
                background: transparent;
            }
            #global-settings-search-overlay input[type="range"].custom-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: var(--theme-primary, #00d0ff);
                cursor: pointer;
                box-shadow: 0 0 10px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.8 * var(--glow-intensity, 1))), 0 0 15px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.6 * var(--glow-intensity, 1)));
                margin-top: calc((4px - 12px) / 2);
            }
            #global-settings-search-overlay input[type="range"].custom-slider::-moz-range-track {
                height: 4px;
                background: transparent;
            }
            #global-settings-search-overlay input[type="range"].custom-slider::-moz-range-thumb {
                width: 12px;
                height: 12px;
                border: none;
                border-radius: 50%;
                background: var(--theme-primary, #00d0ff);
                cursor: pointer;
                box-shadow: 0 0 10px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.8 * var(--glow-intensity, 1)));
            }
            #global-settings-search-overlay .search-result-controls .flex.items-center.gap-3 {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                width: 100%;
            }
            #global-settings-search-overlay .search-result-item.qa-selected {
                border-color: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.45) !important;
                box-shadow: 0 0 0 1px rgba(var(--theme-primary-rgb, 0, 208, 255), 0.25), 0 0 14px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.18 * var(--glow-intensity, 1))) !important;
            }
            #global-settings-search-overlay .qa-enter-target:not(.search-result-item) {
                outline: 2px solid var(--theme-primary, #00d0ff) !important;
                outline-offset: 2px;
                box-shadow: 0 0 10px rgba(var(--theme-primary-rgb, 0, 208, 255), calc(0.45 * var(--glow-intensity, 1))) !important;
            }
            #global-settings-search-overlay .qa-command {
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.75rem;
            }
            #global-settings-search-overlay .qa-command .search-result-name { margin-bottom: 0; }
            #global-settings-search-overlay .qa-command-desc {
                font-size: 0.6875rem;
                color: #64748b;
                margin-top: 0.125rem;
            }
            #global-settings-search-overlay .qa-badge {
                flex-shrink: 0;
                font-size: 0.5625rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                padding: 0.15rem 0.45rem;
                border-radius: 9999px;
                color: var(--theme-primary, #00d0ff);
                background: rgba(var(--theme-primary-rgb, 0, 208, 255), 0.12);
                border: 1px solid rgba(var(--theme-primary-rgb, 0, 208, 255), 0.3);
            }
            #global-settings-search-overlay .qa-enter-hint {
                flex-shrink: 0;
                font-size: 0.5625rem;
                font-weight: 700;
                color: #64748b;
                font-family: 'Roboto Mono', monospace;
                padding: 0.1rem 0.4rem;
                border-radius: 0.375rem;
                border: 1px solid rgba(255,255,255,0.12);
                display: none;
            }
            #global-settings-search-overlay .search-result-item.qa-selected .qa-enter-hint { display: inline-block; }
            #global-settings-search-overlay .gss-empty {
                text-align: center;
                padding: 2rem 1rem;
                color: #94a3b8;
                font-size: 0.875rem;
                font-weight: 600;
            }
        `;
        document.head.appendChild(style);
    }

    function injectOverlay() {
        // Rebuild overlay so a stale DOM from an older CSS approach can't linger
        const existingOverlay = document.getElementById('global-settings-search-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
            overlayEl = null;
            searchInput = null;
            searchClearBtn = null;
            resultsPanel = null;
            resultsContainer = null;
        }
        injectStyles();

        overlayEl = document.createElement('div');
        overlayEl.id = 'global-settings-search-overlay';
        overlayEl.innerHTML = `
            <div class="gss-backdrop" data-gss-close></div>
            <div class="gss-inner">
                <div class="search-area">
                    <div class="search-wrapper glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
                        <span class="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-[16px] pointer-events-none" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#64748b;font-size:16px;pointer-events:none;">search</span>
                        <input id="global-settings-search-input" type="text" class="search-input" placeholder="Type / to navigate pages" autocomplete="off" />
                        <button type="button" id="global-settings-search-clear" class="search-clear-btn" title="Clear search">
                            <span class="material-symbols-outlined text-[14px]">close</span>
                        </button>
                    </div>
                    <div class="quick-settings">
                        <button type="button" class="quick-btn glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]" data-quick-category="language-content" data-quick-sub="">
                            <span class="material-symbols-outlined">translate</span>
                            <span class="quick-btn-tooltip">Language</span>
                        </button>
                        <button type="button" class="quick-btn glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]" data-quick-category="look-feel" data-quick-sub="Font">
                            <span class="material-symbols-outlined">text_fields</span>
                            <span class="quick-btn-tooltip">Font</span>
                        </button>
                        <button type="button" class="quick-btn glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]" data-quick-category="live-feed" data-quick-sub="">
                            <span class="material-symbols-outlined">speed</span>
                            <span class="quick-btn-tooltip">Live Stats</span>
                        </button>
                        <button type="button" class="quick-btn glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]" data-quick-category="results-graphs" data-quick-sub="Thresholds">
                            <span class="material-symbols-outlined">tune</span>
                            <span class="quick-btn-tooltip">Thresholds</span>
                        </button>
                        <button type="button" class="quick-btn glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]" data-quick-category="test-rules" data-quick-sub="Test Options">
                            <span class="material-symbols-outlined">rule</span>
                            <span class="quick-btn-tooltip">Difficulty</span>
                        </button>
                    </div>
                </div>
                <div id="global-settings-search-results-panel" class="gss-results-panel glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[20px_0_50px_rgba(0,0,0,0.5)]">
                    <div id="global-settings-search-results"></div>
                    <div class="gss-scrollbar" aria-hidden="true"><div class="gss-scrollbar-thumb"></div></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlayEl);

        searchInput = document.getElementById('global-settings-search-input');
        searchClearBtn = document.getElementById('global-settings-search-clear');
        resultsPanel = document.getElementById('global-settings-search-results-panel');
        resultsContainer = document.getElementById('global-settings-search-results');
        resultsContainer.addEventListener('scroll', syncCustomScrollbar, { passive: true });
        window.addEventListener('resize', syncCustomScrollbar);
        wireCustomScrollbar();

        overlayEl.querySelector('[data-gss-close]').addEventListener('click', closeOverlay);
        overlayEl.addEventListener('keydown', (e) => {
            if (isOpen) e.stopPropagation();
        });
        searchInput.addEventListener('input', () => { lastSearch = onSearchInput(); });
        searchClearBtn.addEventListener('click', clearSearch);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                closeOverlay();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!currentEntries.length) return;
                e.preventDefault();
                const dir = e.key === 'ArrowDown' ? 1 : -1;
                const next = (selectedIndex + dir + currentEntries.length) % currentEntries.length;
                setSelected(next, true);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                Promise.resolve(lastSearch).then(() => stepOption(e.shiftKey ? -1 : 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                Promise.resolve(lastSearch).then(activateSelected);
            }
        });

        overlayEl.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const categoryId = btn.dataset.quickCategory;
                const subSetting = btn.dataset.quickSub || '';
                searchInput.value = '';
                searchClearBtn.classList.remove('visible');
                showCategoryResults(categoryId, subSetting);
            });
        });
    }

    function norm(str) {
        return (str || '').replace(/\s+/g, ' ').trim();
    }

    async function ensureSearchIndex() {
        if (searchIndex && searchIndex.length) return searchIndex;
        if (indexPromise) return indexPromise;

        indexPromise = (async () => {
            if (document.querySelector('.category-content')) {
                indexDoc = document;
            } else {
                var html = null;
                if (typeof window.__USERTYPO_GET_PAGE_FRAGMENT__ === 'function') {
                    html = window.__USERTYPO_GET_PAGE_FRAGMENT__('pages/settings.html');
                }
                if (!html && window.__USERTYPO_PAGE_FRAGMENTS__) {
                    html = window.__USERTYPO_PAGE_FRAGMENTS__['pages/settings.html'];
                }
                if (!html) {
                    const res = await fetch('pages/settings.html');
                    if (!res.ok) throw new Error('Failed to load settings search index');
                    html = await res.text();
                }
                indexDoc = new DOMParser().parseFromString(html, 'text/html');
            }
            searchIndex = buildSearchIndexFromDoc(indexDoc);
            return searchIndex;
        })();

        return indexPromise;
    }

    function buildSearchIndexFromDoc(doc) {
        const index = [];
        const seen = new Set();

        doc.querySelectorAll('.category-content').forEach(content => {
            const categoryId = content.dataset.panel;
            const navCard = doc.querySelector(`.setting-card[data-category="${categoryId}"]`);
            if (!navCard) return;
            const categoryName = norm(navCard.querySelector('.card-title')?.textContent) || '';

            content.querySelectorAll('.setting-toggle-row, .flex.flex-col.gap-2.relative').forEach((row, rowIdx) => {
                if (row.closest('.sub-setting-content')) return;
                const nameEl = row.querySelector('p.text-sm.font-semibold, label.text-xs.font-semibold');
                const descEl = row.querySelector('p.text-xs.text-slate-500');
                if (!nameEl) return;
                const name = norm(nameEl.textContent);
                const descText = descEl ? norm(descEl.textContent) : '';
                
                const rowClone = row.cloneNode(true);
                rowClone.querySelector('p.text-sm.font-semibold, label.text-xs.font-semibold')?.remove();
                rowClone.querySelector('p.text-xs.text-slate-500')?.remove();
                rowClone.querySelectorAll('.info-popover, .info-icon-wrapper').forEach(e => e.remove());
                const keywords = norm(rowClone.textContent);
                
                const key = categoryId + '::' + name;
                if (seen.has(key)) return;
                seen.add(key);
                index.push({
                    name,
                    desc: descText,
                    categoryName,
                    categoryId,
                    subSetting: '',
                    keywords,
                    rowKey: `${categoryId}::${rowIdx}::${name}`,
                });
            });

            content.querySelectorAll('.sub-setting-card').forEach(subCard => {
                const subName = subCard.dataset.subTitle || '';
                const subContent = subCard.querySelector('.sub-setting-content');
                if (!subContent) return;
                subContent.querySelectorAll('.setting-toggle-row, .flex.flex-col.gap-2.relative').forEach((row, rowIdx) => {
                    const nameEl = row.querySelector('p.text-sm.font-semibold, label.text-xs.font-semibold');
                    const descEl = row.querySelector('p.text-xs.text-slate-500');
                    if (!nameEl) return;
                    const name = norm(nameEl.textContent);
                    const descText = descEl ? norm(descEl.textContent) : '';
                    
                    const rowClone = row.cloneNode(true);
                    rowClone.querySelector('p.text-sm.font-semibold, label.text-xs.font-semibold')?.remove();
                    rowClone.querySelector('p.text-xs.text-slate-500')?.remove();
                    rowClone.querySelectorAll('.info-popover, .info-icon-wrapper').forEach(e => e.remove());
                    const keywords = norm(rowClone.textContent);
                    
                    const key = categoryId + '::' + subName + '::' + name;
                    if (seen.has(key)) return;
                    seen.add(key);
                    index.push({
                        name,
                        desc: descText,
                        categoryName: categoryName + ' › ' + subName,
                        categoryId,
                        subSetting: subName,
                        keywords,
                        rowKey: `${categoryId}::${subName}::${rowIdx}::${name}`,
                    });
                });
            });
        });

        return index;
    }

    function findRowElement(item) {
        const doc = indexDoc || document;
        const content = doc.querySelector(`.category-content[data-panel="${item.categoryId}"]`);
        if (!content) return null;

        const scope = item.subSetting
            ? Array.from(content.querySelectorAll('.sub-setting-card'))
                .find(c => c.dataset.subTitle === item.subSetting)?.querySelector('.sub-setting-content')
            : content;
        if (!scope) return null;

        const rows = scope.querySelectorAll('.setting-toggle-row, .flex.flex-col.gap-2.relative');
        for (const row of rows) {
            if (!item.subSetting && row.closest('.sub-setting-content')) continue;
            const nameEl = row.querySelector('p.text-sm.font-semibold, label.text-xs.font-semibold');
            if (nameEl && norm(nameEl.textContent) === item.name) return row;
        }
        return null;
    }

    function extractControls(row) {
        const wrapper = document.createElement('div');
        wrapper.className = 'search-result-controls';

        if (row.classList.contains('setting-toggle-row')) {
            const toggle = row.querySelector('.toggle-track');
            const optGroup = row.querySelector('[data-setting].flex.gap-2, [data-setting].flex.gap-2.flex-wrap');
            if (optGroup) {
                wrapper.appendChild(optGroup.cloneNode(true));
            } else if (toggle) {
                wrapper.appendChild(toggle.cloneNode(true));
            }
        } else {
            const directControls = row.querySelectorAll(':scope > [data-setting]');
            if (directControls.length) {
                directControls.forEach(el => wrapper.appendChild(el.cloneNode(true)));
            } else {
                const children = Array.from(row.children);
                for (let i = 1; i < children.length; i++) {
                    const child = children[i];
                    if (child.id === 'dynamic-keymap-container' || child.id === 'room-keymap-container') continue;
                    if (child.querySelector('.info-icon-wrapper') && !child.querySelector('[data-setting]')) continue;
                    wrapper.appendChild(child.cloneNode(true));
                }
                if (!wrapper.children.length) {
                    row.querySelectorAll('[data-setting]').forEach(el => {
                        wrapper.appendChild(el.cloneNode(true));
                    });
                }
            }
        }

        wrapper.querySelectorAll('#dynamic-keymap-container, [id*="keymap-container"], .info-icon-wrapper, .info-popover').forEach(el => el.remove());
        wrapper.querySelectorAll('.flex.items-center.gap-2').forEach(el => {
            if (!el.querySelector('[data-setting]') && el.querySelector('label')) el.remove();
        });
        wrapper.querySelectorAll('.sub-setting-content.hidden').forEach(el => el.classList.remove('hidden'));
        wrapper.querySelectorAll('.setting-select').forEach(el => el.remove());

        return wrapper;
    }

    function updateSlider(slider) {
        const min = parseFloat(slider.min) || 0;
        const max = parseFloat(slider.max) || 100;
        const val = parseFloat(slider.value);
        const fraction = (val - min) / (max - min);
        const percentage = fraction * 100;
        const bgSize = `calc(6px + ${percentage}% - ${fraction * 12}px) 4px, 100% 4px`;
        slider.style.setProperty('background-size', bgSize, 'important');
    }

    function afterSettingChange() {
        const settingsApi = api();
        if (!settingsApi) return;
        const settings = settingsApi.loadSettings();
        settingsApi.applyAllSettings?.(settings);
        settingsApi.restoreUI?.(settings);
        document.querySelectorAll('#global-settings-search-overlay input[type="range"].custom-slider').forEach(updateSlider);
    }

    function wireControls(container) {
        const settingsApi = api();
        if (!settingsApi) return;

        container.querySelectorAll('.opt-btn').forEach(btn => {
            btn.removeAttribute('onclick');

            if (btn.closest('.custom-popover-wrapper') && !btn.closest('.custom-popover')) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.toggleCustomPopover?.(btn);
                });
                return;
            }
            if (btn.closest('.custom-popover')) return;

            if (btn.classList.contains('lang-btn') && typeof window.selectLangOpt === 'function') {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.selectLangOpt(btn);
                    afterSettingChange();
                });
                return;
            }

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const group = btn.closest('[data-setting]');
                if (!group) return;
                group.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settingsApi.persistFromOpt(btn);
                afterSettingChange();
            });
        });

        container.querySelectorAll('.toggle-track').forEach(track => {
            track.removeAttribute('onclick');
            track.addEventListener('click', (e) => {
                e.stopPropagation();
                track.classList.toggle('on');
                settingsApi.persistFromToggle(track);
                afterSettingChange();
            });
        });

        container.querySelectorAll('input[type="range"].custom-slider').forEach(slider => {
            updateSlider(slider);
            slider.addEventListener('input', () => {
                updateSlider(slider);
                const path = slider.closest('[data-setting]')?.dataset.setting;
                if (path === 'lookFeel.glowIntensity' && settingsApi.applyGlowIntensityVar) {
                    const sets = settingsApi.loadSettings();
                    settingsApi.setByPath(sets, path, parseFloat(slider.value));
                    settingsApi.applyGlowIntensityVar(sets);
                }
            });
            slider.addEventListener('change', () => {
                const path = slider.closest('[data-setting]')?.dataset.setting;
                if (path) {
                    const sets = settingsApi.loadSettings();
                    settingsApi.setByPath(sets, path, parseFloat(slider.value));
                    settingsApi.saveSettings(sets);
                    if (path === 'lookFeel.glowIntensity' && settingsApi.applyGlowIntensityVar) {
                        settingsApi.applyGlowIntensityVar(sets);
                    }
                }
                afterSettingChange();
            });
        });
    }

    let scrollbarDragging = false;

    function syncCustomScrollbar() {
        if (!resultsPanel || !resultsContainer || scrollbarDragging) return;
        const thumb = resultsPanel.querySelector('.gss-scrollbar-thumb');
        if (!thumb) return;

        const { scrollTop, scrollHeight, clientHeight } = resultsContainer;
        const canScroll = scrollHeight > clientHeight + 1;
        resultsPanel.classList.toggle('has-scroll', canScroll);
        if (!canScroll) return;

        const track = resultsPanel.querySelector('.gss-scrollbar');
        const trackH = track ? track.clientHeight : clientHeight;
        const thumbH = Math.max(20, (clientHeight / scrollHeight) * trackH);
        const maxTop = Math.max(0, trackH - thumbH);
        const top = maxTop === 0 ? 0 : (scrollTop / (scrollHeight - clientHeight)) * maxTop;
        thumb.style.height = `${thumbH}px`;
        thumb.style.transform = `translateY(${top}px)`;
    }

    function wireCustomScrollbar() {
        if (!resultsPanel || !resultsContainer) return;
        const track = resultsPanel.querySelector('.gss-scrollbar');
        const thumb = resultsPanel.querySelector('.gss-scrollbar-thumb');
        if (!track || !thumb || track.dataset.wired === '1') return;
        track.dataset.wired = '1';

        const scrollFromPointerY = (clientY) => {
            const { scrollHeight, clientHeight } = resultsContainer;
            const maxScroll = scrollHeight - clientHeight;
            if (maxScroll <= 0) return;
            const rect = track.getBoundingClientRect();
            const trackH = rect.height;
            const thumbH = thumb.offsetHeight || 20;
            const maxTop = Math.max(0, trackH - thumbH);
            const y = clientY - rect.top - thumbH / 2;
            const ratio = maxTop === 0 ? 0 : Math.min(1, Math.max(0, y / maxTop));
            resultsContainer.scrollTop = ratio * maxScroll;
            thumb.style.height = `${Math.max(20, (clientHeight / scrollHeight) * trackH)}px`;
            thumb.style.transform = `translateY(${ratio * maxTop}px)`;
        };

        thumb.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scrollbarDragging = true;
            thumb.setPointerCapture(e.pointerId);
            const onMove = (ev) => {
                scrollFromPointerY(ev.clientY);
            };
            const onUp = (ev) => {
                scrollbarDragging = false;
                thumb.releasePointerCapture(ev.pointerId);
                thumb.removeEventListener('pointermove', onMove);
                thumb.removeEventListener('pointerup', onUp);
                thumb.removeEventListener('pointercancel', onUp);
                syncCustomScrollbar();
            };
            thumb.addEventListener('pointermove', onMove);
            thumb.addEventListener('pointerup', onUp);
            thumb.addEventListener('pointercancel', onUp);
        });

        track.addEventListener('pointerdown', (e) => {
            if (e.target === thumb) return;
            e.preventDefault();
            e.stopPropagation();
            scrollFromPointerY(e.clientY);
            scrollbarDragging = true;
            track.setPointerCapture(e.pointerId);
            const onMove = (ev) => scrollFromPointerY(ev.clientY);
            const onUp = (ev) => {
                scrollbarDragging = false;
                track.releasePointerCapture(ev.pointerId);
                track.removeEventListener('pointermove', onMove);
                track.removeEventListener('pointerup', onUp);
                track.removeEventListener('pointercancel', onUp);
                syncCustomScrollbar();
            };
            track.addEventListener('pointermove', onMove);
            track.addEventListener('pointerup', onUp);
            track.addEventListener('pointercancel', onUp);
        });
    }

    // ── Context commands (home config bar, leaderboard filters) and pages ──

    function currentPath() {
        let p = (location.pathname || '/').replace(/\/+$/, '').replace(/\.html$/, '') || '/';
        if (p === '/index') p = '/';
        return p;
    }

    function byId(id) { return document.getElementById(id); }
    function clickId(id) { const el = byId(id); if (el) el.click(); }
    function hasClass(id, cls) { const el = byId(id); return !!(el && el.classList.contains(cls)); }

    function getHomeCommands() {
        if (!byId('config-bar') || !byId('btn-time')) return [];
        const cat = 'Test Config';
        const customActive = () => hasClass('btn-custom', 'is-active');
        const ensureMode = (mode) => {
            if (!hasClass(`btn-${mode}`, 'is-active')) clickId(`btn-${mode}`);
        };
        const amountActive = (mode, slot) => () =>
            !customActive() && hasClass(`btn-${mode}`, 'is-active') && hasClass(`btn-amt-${slot}`, 'is-active');
        const cmds = [];
        [['time', 'Time', [15, 30, 60, 120], 'seconds'], ['words', 'Words', [10, 25, 50, 100], 'words']]
            .forEach(([mode, label, values, unit]) => {
                values.forEach((v, i) => cmds.push({
                    id: `home-${mode}-${v}`,
                    label: `${label} ${v}`,
                    category: cat,
                    desc: `${v} ${unit}`,
                    aliases: `${unit} mode`,
                    isActive: amountActive(mode, i),
                    run: () => {
                        ensureMode(mode);
                        if (typeof window.setTestAmountValue === 'function') window.setTestAmountValue(i);
                        else clickId(`btn-amt-${i}`);
                    },
                }));
                cmds.push({
                    id: `home-${mode}-inf`,
                    label: `${label} ∞`,
                    category: cat,
                    desc: `Infinite ${mode === 'time' ? 'time' : 'words'}`,
                    aliases: 'infinite infinity inf unlimited',
                    isActive: amountActive(mode, 'inf'),
                    run: () => { ensureMode(mode); clickId('btn-amt-inf'); },
                });
                cmds.push({
                    id: `home-${mode}-custom`,
                    label: `${label} Custom`,
                    category: cat,
                    desc: `Custom ${unit} amount`,
                    aliases: 'custom amount',
                    isActive: amountActive(mode, 'custom'),
                    run: () => { ensureMode(mode); clickId('btn-amt-custom'); },
                });
            });
        cmds.push({
            id: 'home-custom-text',
            label: 'Custom Text',
            category: cat,
            desc: 'Type your own text',
            aliases: 'mode',
            isActive: customActive,
            run: () => clickId('btn-custom'),
        });
        if (customActive()) {
            cmds.push({
                id: 'home-custom-edit',
                label: 'Edit Custom Text',
                category: cat,
                desc: 'Open the custom text editor',
                aliases: '',
                isActive: () => false,
                run: () => clickId('btn-custom-edit'),
            });
        } else {
            cmds.push(
                { id: 'home-punct', label: 'Punctuation', category: cat, desc: 'Toggle punctuation', aliases: 'toggle', isActive: () => hasClass('btn-punct', 'is-active'), run: () => clickId('btn-punct') },
                { id: 'home-num', label: 'Numbers', category: cat, desc: 'Toggle numbers', aliases: 'toggle', isActive: () => hasClass('btn-num', 'is-active'), run: () => clickId('btn-num') },
                { id: 'home-adapt', label: 'Adapt & Refine', category: cat, desc: 'Practise your weak keys', aliases: 'adapt refine weakness toggle', isActive: () => hasClass('btn-adapt-refine', 'is-active'), run: () => clickId('btn-adapt-refine') },
            );
        }
        return cmds;
    }

    function getLeaderboardCommands() {
        if (!byId('cfg-global')) return [];
        const cat = 'Leaderboard';
        const on = (id) => hasClass(id, 'text-primary');
        const cmds = [
            ['global', 'Global', 'Scope', 'world'],
            ['country', 'Country', 'Scope', 'nation'],
            ['friends', 'Friends', 'Scope', ''],
        ].map(([v, label, group, aliases]) => ({
            id: `lb-scope-${v}`, label, category: `${cat} › ${group}`, desc: `${label} leaderboard`, aliases,
            isActive: () => on(`cfg-${v}`), run: () => clickId(`cfg-${v}`),
        }));
        [['alltime', 'All Time', 'ever'], ['weekly', 'Weekly', 'week'], ['daily', 'Daily', 'day today']]
            .forEach(([v, label, aliases]) => cmds.push({
                id: `lb-time-${v}`, label, category: `${cat} › Period`, desc: `${label} rankings`, aliases,
                isActive: () => on(`cfg-${v}`), run: () => clickId(`cfg-${v}`),
            }));
        [['time', 'Time', [15, 30, 60], 'seconds'], ['words', 'Words', [10, 25, 50], 'words']]
            .forEach(([mode, label, values, unit]) => {
                values.forEach((v, i) => cmds.push({
                    id: `lb-${mode}-${v}`,
                    label: `${label} ${v}`,
                    category: `${cat} › Mode`,
                    desc: `${v} ${unit}`,
                    aliases: `${unit} mode`,
                    isActive: () => on(`cfg-mode-${mode}`) && on(`cfg-amt-${i}`),
                    run: () => {
                        if (!on(`cfg-mode-${mode}`)) clickId(`cfg-mode-${mode}`);
                        clickId(`cfg-amt-${i}`);
                    },
                }));
            });
        return cmds;
    }

    function getContextCommands() {
        const path = currentPath();
        if (path === '/') return getHomeCommands();
        if (path === '/leaderboards') return getLeaderboardCommands();
        return [];
    }

    const PAGES = [
        { path: '/', label: 'Typing Test', aliases: 'home test type' },
        { path: '/friends', label: 'Friends', aliases: '' },
        { path: '/multiplayer', label: 'Multiplayer', aliases: 'race room versus' },
        { path: '/leaderboards', label: 'Leaderboards', aliases: 'leaderboard ranking' },
        { action: 'notifications', label: 'Notifications', aliases: 'inbox bell alerts' },
        { path: '/settings', label: 'Settings', aliases: 'preferences options' },
        { path: '/userstats', label: 'Profile', aliases: 'user stats userstats account' },
        { path: '/about', label: 'About', aliases: '' },
        { path: '/how-it-works', label: 'How It Works', aliases: 'help' },
        { path: '/privacy', label: 'Privacy', aliases: 'policy' },
        { path: '/terms', label: 'Terms', aliases: 'service conditions' },
        { path: '/security', label: 'Security', aliases: '' },
    ];

    function getPageCommands() {
        const here = currentPath();
        return PAGES.filter(p => !p.path || p.path !== here).map(p => ({
            id: `page-${p.path || p.action}`,
            label: p.label,
            category: 'Pages',
            desc: p.path ? p.path : 'Open the notifications box',
            aliases: p.aliases + ' ' + (p.path || ''),
            isActive: () => false,
            run: () => {
                if (p.action === 'notifications') {
                    if (typeof window.openNotifications === 'function') window.openNotifications();
                } else if (typeof window.navigateTo === 'function') {
                    window.navigateTo(p.path);
                } else {
                    location.href = p.path;
                }
            },
        }));
    }

    // ── Matching (case-insensitive, every token must match) ──

    function tokenize(q) {
        return norm(q).toLowerCase().split(' ').filter(Boolean);
    }

    // Returns null when some token doesn't match, otherwise a relevance score.
    function scoreCommand(cmd, tokens) {
        if (!tokens.length) return 0;
        const label = cmd.label.toLowerCase();
        const words = label.split(/\s+/);
        const extra = `${cmd.aliases || ''} ${cmd.category || ''} ${cmd.desc || ''}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
            if (words.includes(t)) score += 3;
            else if (words.some(w => w.startsWith(t))) score += 2;
            else if (label.includes(t)) score += 1;
            else if (extra.includes(t)) score += 0.5;
            else return null;
        }
        if (label.startsWith(tokens[0])) score += 0.5;
        return score;
    }

    function rankCommands(cmds, tokens) {
        return cmds
            .map((cmd, i) => ({ cmd, i, s: scoreCommand(cmd, tokens) }))
            .filter(x => x.s !== null)
            .sort((a, b) => (b.s - a.s) || (a.i - b.i))
            .map(x => ({ type: 'command', cmd: x.cmd }));
    }

    function settingMatches(item, tokens) {
        const hay = `${item.name} ${item.keywords || ''}`.toLowerCase();
        return tokens.every(t => hay.includes(t));
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function highlightText(text, tokens) {
        if (!tokens || !tokens.length) return text;
        const parts = tokens.slice().sort((a, b) => b.length - a.length)
            .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regex = new RegExp(`(${parts.join('|')})`, 'gi');
        return text.replace(regex, '<span class="search-highlight text-primary">$1</span>');
    }

    // ── Selection / Enter ──

    // Every option Enter/Tab can land on inside a setting result, in visual order.
    function findSettingTargets(controls) {
        const visible = (el) => el.style.display !== 'none' && !el.closest('.custom-popover');
        const opts = Array.from(controls.querySelectorAll('.opt-btn, .lang-btn, .font-btn, [data-lang]'))
            .filter(el => visible(el) && !(el.closest('.custom-popover-wrapper')));
        if (opts.length) return opts;
        return Array.from(controls.querySelectorAll('.toggle-track')).slice(0, 1);
    }

    // Selection = result index + option index within that result (Tab steps options).
    function setSelected(index, scroll, sub = 0) {
        currentEntries.forEach((r, i) => {
            const on = i === index;
            r.el.classList.toggle('qa-selected', on);
            r.targets.forEach((t, j) => t.classList.toggle('qa-enter-target', on && j === sub));
        });
        selectedIndex = index;
        selectedSub = sub;
        const r = currentEntries[index];
        if (scroll && r) {
            (r.targets[sub] && r.targets[sub] !== r.el ? r.targets[sub] : r.el).scrollIntoView({ block: 'nearest' });
            requestAnimationFrame(syncCustomScrollbar);
        }
    }

    // Tab / Shift+Tab: walk every option of every result one by one, wrapping around.
    function stepOption(dir) {
        if (!currentEntries.length) return;
        const count = (i) => Math.max(1, currentEntries[i].targets.length);
        let i = selectedIndex;
        let j = selectedSub + dir;
        if (j >= count(i)) {
            i = (i + 1) % currentEntries.length;
            j = 0;
        } else if (j < 0) {
            i = (i - 1 + currentEntries.length) % currentEntries.length;
            j = count(i) - 1;
        }
        setSelected(i, true, j);
    }

    function runCommand(cmd) {
        closeOverlay();
        try { cmd.run(); } catch (err) { console.error('[quick actions] command failed', err); }
    }

    function activateSelected() {
        const r = currentEntries[selectedIndex];
        if (!r) return;
        if (r.entry.type === 'command') {
            runCommand(r.entry.cmd);
            return;
        }
        const target = r.targets[selectedSub];
        if (target) target.click();
    }

    const RESULT_CLASS = 'search-result-item glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.1)]';

    function renderCommandEntry(cmd, tokens) {
        const el = document.createElement('div');
        el.className = RESULT_CLASS + ' qa-command';
        const active = cmd.isActive && cmd.isActive();
        el.innerHTML = `
            <div style="min-width:0">
                <div class="search-result-category text-primary">${highlightText(escapeHtml(cmd.category), tokens)}</div>
                <div class="search-result-name">${highlightText(escapeHtml(cmd.label), tokens)}</div>
                ${cmd.desc ? `<div class="qa-command-desc">${escapeHtml(cmd.desc)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem">
                ${active ? '<span class="qa-badge">Active</span>' : ''}
                <span class="qa-enter-hint">enter</span>
            </div>
        `;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            runCommand(cmd);
        });
        return el;
    }

    function renderSettingEntry(item, tokens) {
        const row = findRowElement(item);
        const el = document.createElement('div');
        el.className = RESULT_CLASS;

        el.innerHTML = `
            <div class="search-result-category text-primary">${highlightText(item.categoryName, tokens)}</div>
            <div class="search-result-name">${highlightText(item.name, tokens)}</div>
            ${item.desc ? `<div class="search-result-desc">${highlightText(item.desc, tokens)}</div>` : ''}
        `;

        let controls = null;
        if (row) {
            controls = extractControls(row);
            // Custom popovers must stay closed until the user clicks Custom
            controls.querySelectorAll('.custom-popover').forEach(p => {
                p.classList.remove('is-open', 'is-portaled', 'opacity-100', 'pointer-events-auto');
                p.classList.add('opacity-0', 'pointer-events-none');
            });
            if (tokens.length) {
                const title = `${item.name} ${item.desc} ${item.categoryName}`.toLowerCase();
                const optionTokens = tokens.filter(t => !title.includes(t));
                if (optionTokens.length) {
                    controls.querySelectorAll('.opt-btn, [data-lang], .lang-btn, .font-btn').forEach(btn => {
                        if (btn.closest('.custom-popover')) return;
                        const text = norm(btn.textContent).toLowerCase();
                        if (!optionTokens.some(t => text.includes(t))) {
                            btn.style.display = 'none';
                        }
                    });
                }
            }
            wireControls(controls);
            el.appendChild(controls);
        }
        return { el, controls };
    }

    function renderResults(entries, tokens) {
        if (typeof closeAllCustomPopovers === 'function') closeAllCustomPopovers();
        tokens = tokens || [];

        const settingsApi = api();
        currentEntries = [];
        selectedIndex = 0;
        resultsPanel.classList.add('active');

        if (!entries.length) {
            resultsContainer.innerHTML = '<p class="gss-empty">No results found.</p>';
            requestAnimationFrame(syncCustomScrollbar);
            return;
        }

        resultsContainer.innerHTML = '';
        const settingRows = [];

        entries.forEach(entry => {
            if (entry.type === 'command') {
                const el = renderCommandEntry(entry.cmd, tokens);
                resultsContainer.appendChild(el);
                currentEntries.push({ entry, el, targets: [el] });
            } else {
                const { el, controls } = renderSettingEntry(entry.item, tokens);
                resultsContainer.appendChild(el);
                const rec = { entry, el, targets: [] };
                currentEntries.push(rec);
                if (controls) settingRows.push({ rec, controls });
            }
        });

        if (settingsApi) {
            settingsApi.restoreUI(settingsApi.loadSettings());
            resultsContainer.querySelectorAll('input[type="range"].custom-slider').forEach(updateSlider);
        }
        // Resolve Enter targets after restoreUI so visibility/state is final
        settingRows.forEach(({ rec, controls }) => { rec.targets = findSettingTargets(controls); });

        setSelected(0, false);
        requestAnimationFrame(syncCustomScrollbar);
    }

    async function onSearchInput() {
        const raw = norm(searchInput.value);
        searchClearBtn.classList.toggle('visible', raw.length > 0);

        if (!raw.length) {
            resultsPanel.classList.remove('active');
            resultsContainer.innerHTML = '';
            currentEntries = [];
            return;
        }

        // "/" prefix → pages only
        if (raw.startsWith('/')) {
            const tokens = tokenize(raw.slice(1));
            const pages = getPageCommands();
            const entries = tokens.length
                ? rankCommands(pages, tokens)
                : pages.map(cmd => ({ type: 'command', cmd }));
            renderResults(entries, tokens);
            return;
        }

        const tokens = tokenize(raw);
        const commandEntries = rankCommands(getContextCommands(), tokens);
        await ensureSearchIndex();
        // Input may have changed while the index loaded
        if (norm(searchInput.value) !== raw) return;
        const settingEntries = searchIndex
            .filter(item => settingMatches(item, tokens))
            .map(item => ({ type: 'setting', item }));
        renderResults(commandEntries.concat(settingEntries), tokens);
    }

    async function showCategoryResults(categoryId, subSetting) {
        await ensureSearchIndex();
        const entries = searchIndex.filter(item => {
            if (item.categoryId !== categoryId) return false;
            if (subSetting && item.subSetting !== subSetting) return false;
            return true;
        }).map(item => ({ type: 'setting', item }));
        renderResults(entries, []);
    }

    function clearSearch(shouldFocus = true) {
        if (!searchInput) return;
        searchInput.value = '';
        searchClearBtn.classList.remove('visible');
        resultsPanel.classList.remove('active', 'has-scroll');
        resultsContainer.innerHTML = '';
        currentEntries = [];
        if (shouldFocus && isOpen) searchInput.focus({ preventScroll: true });
    }

    function getHeaderOffset() {
        const headers = document.querySelectorAll('header');
        for (const header of headers) {
            if (header.offsetHeight === 0) continue;
            const style = getComputedStyle(header);
            if (style.position === 'fixed' || style.position === 'sticky') {
                return header.getBoundingClientRect().bottom + 12;
            }
            return header.offsetHeight + 12;
        }
        return 80;
    }

    function updateOverlayPosition() {
        if (!overlayEl) return;
        overlayEl.style.setProperty('--gss-top', `${getHeaderOffset()}px`);
    }

    function isMultiplayerTestPage() {
        const path = (location.pathname || '').replace(/\/+$/, '') || '/';
        return path === '/room' || path === '/dual';
    }

    function isTestViewActive() {
        if (!isMultiplayerTestPage()) return false;
        const testView = document.getElementById('test-view');
        if (!testView) return false;
        if (testView.classList.contains('hidden')) return false;
        if (testView.style.display === 'none') return false;
        return true;
    }

    function isShortcutContextAllowed() {
        return !isTestViewActive();
    }

    function insertIntoSearch(char) {
        if (!searchInput) return;
        const start = searchInput.selectionStart ?? searchInput.value.length;
        const end = searchInput.selectionEnd ?? searchInput.value.length;
        searchInput.value = searchInput.value.slice(0, start) + char + searchInput.value.slice(end);
        searchInput.selectionStart = searchInput.selectionEnd = start + char.length;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function isBlockedByOtherModal() {
        const customPrompt = document.getElementById('custom-prompt-modal');
        if (customPrompt && !customPrompt.classList.contains('opacity-0')) return true;
        return false;
    }

    function isQuickActionsEnabled() {
        try {
            const settings = window.usertypo_settingsApi?.loadSettings?.()
                || JSON.parse(localStorage.getItem('usertypo_settings') || '{}');
            // Default on when unset — independent of Keyboard Shortcuts master switch
            return settings?.keyboardLayout?.quickSettings !== false;
        } catch {
            return true;
        }
    }

    function openOverlay() {
        if (!isShortcutContextAllowed()) return;
        if (!isQuickActionsEnabled()) return;
        injectOverlay();
        updateOverlayPosition();
        isOpen = true;
        overlayEl.classList.add('open');
        clearSearch();
        ensureSearchIndex();
        searchInput.focus({ preventScroll: true });
    }

    function closeOverlay() {
        if (!overlayEl) return;
        isOpen = false;
        overlayEl.classList.remove('open');
        clearSearch(false);
        if (searchInput) searchInput.blur();
        if (document.activeElement?.closest('#global-settings-search-overlay')) {
            document.activeElement.blur();
        }
    }

    function toggleOverlay() {
        if (isOpen) closeOverlay();
        else if (!isBlockedByOtherModal()) openOverlay();
    }

    document.addEventListener('keydown', (e) => {
        if (isOpen) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                closeOverlay();
                return;
            }

            const insideOverlay = e.target.closest('#global-settings-search-overlay');
            if (insideOverlay) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                searchInput?.focus({ preventScroll: true });
                insertIntoSearch(e.key);
            } else if (e.key === 'Backspace' && searchInput) {
                searchInput.focus({ preventScroll: true });
                const start = searchInput.selectionStart ?? 0;
                const end = searchInput.selectionEnd ?? 0;
                if (start === end && start > 0) {
                    searchInput.value = searchInput.value.slice(0, start - 1) + searchInput.value.slice(end);
                    searchInput.selectionStart = searchInput.selectionEnd = start - 1;
                } else if (start !== end) {
                    searchInput.value = searchInput.value.slice(0, start) + searchInput.value.slice(end);
                    searchInput.selectionStart = searchInput.selectionEnd = start;
                }
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }

        if (e.key !== 'Escape') return;

        const active = document.activeElement;
        const tag = active?.tagName;
        if (tag === 'TEXTAREA' || (tag === 'INPUT' && active.id !== 'global-settings-search-input')) return;
        if (active?.isContentEditable) return;
        if (isBlockedByOtherModal()) return;
        if (!isShortcutContextAllowed()) return;
        if (!isQuickActionsEnabled()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        openOverlay();
    }, true);

    window.addEventListener('resize', updateOverlayPosition);

    window.usertypo_settingsSearch = {
        open: openOverlay,
        close: closeOverlay,
        toggle: toggleOverlay,
        isOpen: () => isOpen,
    };
    window.usertypo_quickActions = window.usertypo_settingsSearch;
})();
