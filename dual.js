/**
 * usertypo_ Dual — global match-request state & floating indicator
 * Persists across pages via localStorage and drives card + corner UI.
 */
(function () {
    const STORAGE_KEY = 'usertypo_dual_request';
    const PENDING_MS = 30000;
    const PILL_MS = 3000;
    const DISMISS_AFTER_ACCEPT_MS = 60000;
    const TICK_MS = 250;

    const WIDGET_ID = 'dual-global-widget';
    const STYLE_ID = 'dual-global-styles';

    let tickTimer = null;

    function loadRequest() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function saveRequest(data) {
        if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        else localStorage.removeItem(STORAGE_KEY);
    }

    function now() {
        return Date.now();
    }

    function getPhase(request) {
        if (!request) return 'none';

        const elapsed = now() - request.sentAt;

        if (request.status === 'pending') {
            if (elapsed >= PENDING_MS) return 'pill';
            return 'loading';
        }

        if (request.status === 'accepted') {
            const sinceAccept = now() - request.acceptedAt;
            if (sinceAccept >= DISMISS_AFTER_ACCEPT_MS) return 'expired';
            if (sinceAccept < PILL_MS) return 'pill';
            return 'circle';
        }

        return 'none';
    }

    function ensureAccepted(request) {
        if (request.status === 'pending' && now() - request.sentAt >= PENDING_MS) {
            request.status = 'accepted';
            request.acceptedAt = request.sentAt + PENDING_MS;
            saveRequest(request);
        }
        return request;
    }

    // Read the current theme accent color from a probe element so the
    // widget matches whatever theme settings.js has applied.
    function getThemeAccent() {
        try {
            const probe = document.createElement('span');
            probe.className = 'text-primary';
            probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;pointer-events:none;';
            document.body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            const m = c && c.match(/rgba?\(([^)]+)\)/);
            if (m) {
                const parts = m[1].split(',').map(s => parseFloat(s.trim()));
                return { r: parts[0], g: parts[1], b: parts[2] };
            }
        } catch { /* fall through */ }
        return { r: 0, g: 208, b: 255 };
    }

    function applyAccentVars(el) {
        const { r, g, b } = getThemeAccent();
        el.style.setProperty('--dual-accent', `rgb(${r}, ${g}, ${b})`);
        el.style.setProperty('--dual-accent-18', `rgba(${r}, ${g}, ${b}, 0.18)`);
        el.style.setProperty('--dual-accent-20', `rgba(${r}, ${g}, ${b}, 0.20)`);
        el.style.setProperty('--dual-accent-35', `rgba(${r}, ${g}, ${b}, 0.35)`);
        el.style.setProperty('--dual-accent-65', `rgba(${r}, ${g}, ${b}, 0.65)`);
    }

    function spinnerMarkup(extraClass) {
        return `
            <svg class="dual-spin ${extraClass || ''}" viewBox="0 0 50 50" aria-hidden="true">
                <circle class="dual-spin-track" cx="25" cy="25" r="20"></circle>
                <circle class="dual-spin-head" cx="25" cy="25" r="20"></circle>
            </svg>`;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${WIDGET_ID} {
                position: fixed;
                z-index: 55;
                right: 2rem;
                bottom: 2rem;
                pointer-events: none;
            }

            #${WIDGET_ID}.dual-widget--above-chat {
                bottom: 6.5rem;
            }

            #${WIDGET_ID} .dual-widget-btn {
                pointer-events: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0;
                height: 3.5rem;
                min-width: 3.5rem;
                max-width: 3.5rem;
                padding: 0;
                border-radius: 9999px;
                border: 1px solid var(--dual-accent-35, rgba(0,208,255,0.35));
                background: rgba(26, 29, 35, 0.92);
                backdrop-filter: blur(12px);
                color: var(--dual-accent, #00d0ff);
                box-shadow: 0 0 24px var(--dual-accent-18, rgba(0,208,255,0.18));
                overflow: hidden;
                white-space: nowrap;
                transition:
                    max-width 0.5s cubic-bezier(0.16, 1, 0.3, 1),
                    padding 0.5s cubic-bezier(0.16, 1, 0.3, 1),
                    gap 0.35s ease,
                    box-shadow 0.3s ease,
                    border-color 0.3s ease;
                cursor: default;
            }

            #${WIDGET_ID} .dual-widget-btn.is-clickable {
                cursor: pointer;
            }

            #${WIDGET_ID} .dual-widget-btn.is-clickable:hover {
                border-color: var(--dual-accent-65, rgba(0,208,255,0.65));
                box-shadow: 0 0 28px var(--dual-accent-35, rgba(0,208,255,0.35));
            }

            #${WIDGET_ID} .dual-widget-btn.is-pill {
                max-width: 32rem;
                padding: 0 1.35rem;
                gap: 0.65rem;
            }

            #${WIDGET_ID} .dual-widget-label {
                opacity: 0;
                max-width: 0;
                overflow: hidden;
                font-size: 0.8125rem;
                font-weight: 700;
                color: #e2e8f0;
                letter-spacing: 0.01em;
                white-space: nowrap;
                transition: opacity 0.25s ease 0.15s, max-width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
            }

            #${WIDGET_ID} .dual-widget-btn.is-pill .dual-widget-label {
                opacity: 1;
                max-width: 26rem;
            }

            #${WIDGET_ID} .dual-widget-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 1.75rem;
                height: 1.75rem;
            }

            @keyframes dual-widget-spin {
                to { transform: rotate(360deg); }
            }

            .dual-spin {
                width: 1.6rem;
                height: 1.6rem;
                transform-origin: center;
                animation: dual-widget-spin 0.9s linear infinite;
            }
            .dual-spin .dual-spin-track {
                fill: none;
                stroke: var(--dual-accent, #00d0ff);
                stroke-opacity: 0.18;
                stroke-width: 5;
            }
            .dual-spin .dual-spin-head {
                fill: none;
                stroke: var(--dual-accent, #00d0ff);
                stroke-width: 5;
                stroke-linecap: round;
                stroke-dasharray: 80 200;
            }

            .dual-card-loading-corner {
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                right: 1rem;
                z-index: 6;
                width: 1.4rem;
                height: 1.4rem;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: none;
                transition: right 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .friend-card:hover .dual-card-loading-corner {
                right: var(--dual-hover-right, 9.5rem);
            }
            .dual-card-loading-corner .dual-spin {
                width: 1.4rem;
                height: 1.4rem;
            }
        `;
        document.head.appendChild(style);
    }

    function ensureWidget() {
        injectStyles();

        let widget = document.getElementById(WIDGET_ID);
        if (widget) return widget;

        widget = document.createElement('div');
        widget.id = WIDGET_ID;
        if (document.getElementById('lobby-chat-container')) {
            widget.classList.add('dual-widget--above-chat');
        }

        widget.innerHTML = `
            <button type="button" class="dual-widget-btn" aria-live="polite" aria-label="Dual match status">
                <span class="dual-widget-icon" data-role="icon"></span>
                <span class="dual-widget-label" data-role="label">Match Accepted. Click here to join</span>
            </button>
        `;

        widget.querySelector('.dual-widget-btn').addEventListener('click', () => {
            const request = loadRequest();
            if (!request) return;
            const phase = getPhase(ensureAccepted(request));
            if (phase === 'circle' || phase === 'pill') {
                joinDual(request);
            }
        });

        document.body.appendChild(widget);
        return widget;
    }

    function setWidgetVisible(visible) {
        const widget = ensureWidget();
        widget.style.display = visible ? 'block' : 'none';
    }

    function renderWidget() {
        let request = loadRequest();
        if (!request) {
            setWidgetVisible(false);
            return;
        }

        request = ensureAccepted(request);
        const phase = getPhase(request);

        if (phase === 'expired' || phase === 'none') {
            clearRequest();
            return;
        }

        const widget = ensureWidget();
        applyAccentVars(widget);
        const btn = widget.querySelector('.dual-widget-btn');
        const icon = widget.querySelector('[data-role="icon"]');
        const label = widget.querySelector('[data-role="label"]');

        setWidgetVisible(true);

        // Only rebuild the icon/DOM when the phase actually changes — rebuilding
        // every tick would restart the CSS animation and make it "recoil".
        if (widget.dataset.phase !== phase) {
            widget.dataset.phase = phase;
            btn.classList.remove('is-pill', 'is-clickable');

            if (phase === 'loading') {
                icon.innerHTML = spinnerMarkup();
                btn.setAttribute('aria-label', 'Waiting for match response');
            } else if (phase === 'pill') {
                icon.innerHTML = '<span class="material-symbols-outlined text-[22px] text-green-400">check_circle</span>';
                btn.classList.add('is-pill', 'is-clickable');
                btn.setAttribute('aria-label', 'Match accepted. Click to join.');
            } else if (phase === 'circle') {
                icon.innerHTML = '<span class="material-symbols-outlined text-[22px]">swords</span>';
                btn.classList.add('is-clickable');
                btn.setAttribute('aria-label', 'Join dual match');
            }

            label.textContent = 'Match Accepted. Click here to join';
        }
    }

    function findFriendCard(friendName) {
        return Array.from(document.querySelectorAll('.friend-card')).find(card => {
            const name = card.dataset.friendName || card.querySelector('h3')?.textContent?.trim();
            return name === friendName;
        });
    }

    function renderFriendCardLoading() {
        const request = loadRequest();
        const phase = request ? getPhase(ensureAccepted(request)) : 'none';
        const card = (request && phase === 'loading') ? findFriendCard(request.friendName) : null;

        // Remove stray spinners on any card that shouldn't have one
        document.querySelectorAll('.dual-card-loading-corner').forEach(el => {
            if (!card || el.parentElement !== card) el.remove();
        });

        if (!card) return;

        // If the correct card already shows a spinner, leave it running — do NOT
        // recreate it every tick (that restarts the animation and looks glitchy).
        if (card.querySelector('.dual-card-loading-corner')) return;

        if (getComputedStyle(card).position === 'static') {
            card.style.position = 'relative';
        }

        // Compute where the spinner should sit on hover: just left of the chat
        // icon (i.e. left of the action buttons that fade in on hover).
        const actions = card.querySelector('button[title="Chat"]')?.parentElement;
        if (actions) {
            const offset = actions.offsetWidth + 28; // buttons width + gap + padding
            card.style.setProperty('--dual-hover-right', offset + 'px');
        }

        const corner = document.createElement('div');
        corner.className = 'dual-card-loading-corner';
        applyAccentVars(corner);
        corner.innerHTML = spinnerMarkup();
        corner.setAttribute('aria-label', 'Match request pending');
        card.appendChild(corner);
    }

    function renderAll() {
        renderWidget();
        renderFriendCardLoading();
    }

    function clearRequest() {
        saveRequest(null);
        document.querySelectorAll('.dual-card-loading-corner').forEach(el => el.remove());
        const w = document.getElementById(WIDGET_ID);
        if (w) delete w.dataset.phase;
        setWidgetVisible(false);
    }

    function joinDual(request) {
        const params = new URLSearchParams({
            mode: request.config?.mode || 'time',
            amount: request.config?.amount || 30,
            lang: request.config?.lang || 'english',
            punct: request.config?.punct || '0',
            nums: request.config?.nums || '1',
            opponent: request.friendName || '',
            avatar: request.config?.avatar || ''
        });
        window.location.href = `dual.html?${params.toString()}`;
    }

    function startTicker() {
        if (tickTimer) return;
        tickTimer = setInterval(() => {
            const request = loadRequest();
            if (!request) {
                setWidgetVisible(false);
                return;
            }
            const phase = getPhase(ensureAccepted(request));
            if (phase === 'expired') {
                clearRequest();
                return;
            }
            renderAll();
        }, TICK_MS);
    }

    function sendRequest(friendName, config) {
        const data = {
            friendName,
            status: 'pending',
            sentAt: now(),
            acceptedAt: null,
            config: config || {}
        };
        saveRequest(data);
        renderAll();
        startTicker();
        return data;
    }

    window.DualMatch = {
        sendRequest,
        clearRequest,
        loadRequest,
        getPhase: () => getPhase(ensureAccepted(loadRequest())),
        refresh: renderAll
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.friend-card').forEach(card => {
            const name = card.querySelector('h3')?.textContent?.trim();
            if (name) card.dataset.friendName = name;
        });

        renderAll();
        if (loadRequest()) startTicker();
    });

    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) renderAll();
    });
})();
