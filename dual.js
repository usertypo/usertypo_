/**
 * usertypo_ Dual — global match-request state & floating indicator
 * Persists across pages via localStorage and drives card + corner UI.
 *
 * Matchmaking modes:
 *  - challenge: friend-card invite → accept pill → click to join
 *  - matchmaking: Find Match → search spinner → countdown → auto-join
 */
(function () {
    // Prevent a second (stale/cached) copy of this file from wiping matchmaking state.
    const SCRIPT_VERSION = 4;
    if (window.__USERTYPO_DUAL_MATCH_VERSION__ >= SCRIPT_VERSION) return;
    if (window.__USERTYPO_DUAL_MATCH_VERSION__) {
        try { window.DualMatch && window.DualMatch._stopTicker && window.DualMatch._stopTicker(); } catch (_) {}
    }
    window.__USERTYPO_DUAL_MATCH_VERSION__ = SCRIPT_VERSION;

    const STORAGE_KEY = 'usertypo_dual_request';
    const PENDING_MS = 30000;
    const PILL_MS = 3000;
    const DISMISS_AFTER_ACCEPT_MS = 60000;
    const TICK_MS = 250;

    // Matchmaking ("Find Match"): after searching, count down 3→0 then connect.
    const CONNECT_SECONDS = 3;
    const CONNECT_MS = (CONNECT_SECONDS + 1) * 1000; // shows 3,2,1,0 then joins

    const RANDOM_OPPONENTS = [
        'SpeedDemon', 'QuickKeys', 'NeonRacer', 'GhostByte', 'RapidFire',
        'KeyStorm', 'FlashType', 'TypeMaster', 'ByteRunner', 'ZeroLatency'
    ];

    const WIDGET_ID = 'dual-global-widget';
    const STYLE_ID = 'dual-global-styles';
    const _nativeSetInterval = window.setInterval.bind(window);
    const _nativeClearInterval = window.clearInterval.bind(window);

    let tickTimer = null;
    // In-memory copy wins over localStorage so a stale dual.js on another tab
    // cannot clear an active matchmaking session mid-search.
    let memoryRequest = null;
    let joining = false;

    function randomOpponentName() {
        return RANDOM_OPPONENTS[Math.floor(Math.random() * RANDOM_OPPONENTS.length)];
    }

    function now() {
        return Date.now();
    }

    function isMatchmakingRequest(request) {
        if (!request) return false;
        return request.mode === 'matchmaking'
            || request.status === 'searching'
            || request.status === 'found';
    }

    function loadRequest() {
        if (memoryRequest) return memoryRequest;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            memoryRequest = JSON.parse(raw);
            return memoryRequest;
        } catch {
            return null;
        }
    }

    function saveRequest(data) {
        memoryRequest = data || null;
        try {
            if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            else localStorage.removeItem(STORAGE_KEY);
        } catch { /* ignore quota/private-mode */ }
    }

    function getPhase(request) {
        if (!request) return 'none';

        const elapsed = now() - (Number(request.sentAt) || 0);

        // Matchmaking: searching → connecting (countdown) → connect (join)
        if (isMatchmakingRequest(request)) {
            const status = request.status;
            if (status === 'found') {
                const foundAt = Number(request.foundAt) || (Number(request.sentAt) + PENDING_MS);
                const sinceFound = now() - foundAt;
                if (sinceFound >= CONNECT_MS) return 'connect';
                return 'connecting';
            }
            // searching (or any other matchmaking status still waiting)
            if (elapsed >= PENDING_MS) return 'connecting';
            return 'searching';
        }

        // Challenge (friend card)
        if (request.status === 'pending') {
            if (elapsed >= PENDING_MS) return 'pill';
            return 'loading';
        }

        if (request.status === 'accepted') {
            const sinceAccept = now() - (Number(request.acceptedAt) || 0);
            if (sinceAccept >= DISMISS_AFTER_ACCEPT_MS) return 'expired';
            if (sinceAccept < PILL_MS) return 'pill';
            return 'circle';
        }

        return 'none';
    }

    function ensureAccepted(request) {
        if (!request) return request;

        if (isMatchmakingRequest(request)) {
            if (request.status !== 'found' && now() - (Number(request.sentAt) || 0) >= PENDING_MS) {
                request.status = 'found';
                request.mode = 'matchmaking';
                request.foundAt = (Number(request.sentAt) || now()) + PENDING_MS;
                saveRequest(request);
            }
            return request;
        }

        if (request.status === 'pending' && now() - (Number(request.sentAt) || 0) >= PENDING_MS) {
            request.status = 'accepted';
            request.acceptedAt = (Number(request.sentAt) || now()) + PENDING_MS;
            saveRequest(request);
        }
        return request;
    }

    function connectSecondsLeft(request) {
        const foundAt = Number(request.foundAt) || ((Number(request.sentAt) || now()) + PENDING_MS);
        const sinceFound = now() - foundAt;
        return Math.max(0, CONNECT_SECONDS - Math.floor(sinceFound / 1000));
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
                z-index: 9999;
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
        // Friends page find-match UI reuses this id with different markup — rebuild if needed.
        if (widget && !widget.querySelector('.dual-widget-btn')) {
            widget.remove();
            widget = null;
        }
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
            if (phase === 'circle' || phase === 'pill' || phase === 'connecting' || phase === 'connect') {
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

        // Never wipe an active matchmaking / challenge request as "unknown".
        // Older dual.js versions mistook status:"searching" for garbage and
        // called clearRequest(), which is the flash-then-disappear bug.
        if (phase === 'expired') {
            clearRequest();
            return;
        }
        if (phase === 'none') {
            if (isMatchmakingRequest(request) || request.status === 'pending' || request.status === 'accepted') {
                setWidgetVisible(true);
                return;
            }
            clearRequest();
            return;
        }

        // Matchmaking countdown finished → auto-join the match
        if (phase === 'connect') {
            joinDual(request);
            return;
        }

        const widget = ensureWidget();
        applyAccentVars(widget);
        const btn = widget.querySelector('.dual-widget-btn');
        const icon = widget.querySelector('[data-role="icon"]');
        const label = widget.querySelector('[data-role="label"]');
        if (!btn || !icon || !label) {
            widget.remove();
            delete widget.dataset.phase;
            return renderWidget();
        }

        setWidgetVisible(true);

        // Only rebuild the icon/DOM when the phase actually changes — rebuilding
        // every tick would restart the CSS animation and make it "recoil".
        if (widget.dataset.phase !== phase) {
            widget.dataset.phase = phase;
            btn.classList.remove('is-pill', 'is-clickable');

            if (phase === 'loading' || phase === 'searching') {
                icon.innerHTML = spinnerMarkup();
                btn.setAttribute('aria-label', phase === 'searching' ? 'Searching for a match' : 'Waiting for match response');
            } else if (phase === 'pill') {
                icon.innerHTML = '<span class="material-symbols-outlined text-[22px] text-green-400">check_circle</span>';
                btn.classList.add('is-pill', 'is-clickable');
                btn.setAttribute('aria-label', 'Match accepted. Click to join.');
            } else if (phase === 'circle') {
                icon.innerHTML = '<span class="material-symbols-outlined text-[22px]">swords</span>';
                btn.classList.add('is-clickable');
                btn.setAttribute('aria-label', 'Join dual match');
            } else if (phase === 'connecting') {
                icon.innerHTML = '<span class="material-symbols-outlined text-[22px] text-green-400">check_circle</span>';
                btn.classList.add('is-pill', 'is-clickable');
                btn.setAttribute('aria-label', 'Match found. Connecting.');
            }
        }

        // Live label text (updated every tick for the connecting countdown)
        if (phase === 'connecting') {
            label.textContent = `Match Found. Connecting in ${connectSecondsLeft(request)}...`;
        } else {
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
        // Keep matchmaking alive unless an explicit revoke flag is passed —
        // call with { force: true } when the match actually starts (dual.html).
        saveRequest(null);
        document.querySelectorAll('.dual-card-loading-corner').forEach(el => el.remove());
        const w = document.getElementById(WIDGET_ID);
        if (w) delete w.dataset.phase;
        setWidgetVisible(false);
    }

    function clearRequestSafe(opts) {
        const force = opts && opts.force;
        const request = loadRequest();
        // Don't let stale cross-tab / old dual.js wipe an active search.
        if (!force && isMatchmakingRequest(request)) {
            const phase = getPhase(ensureAccepted(request));
            if (phase === 'searching' || phase === 'connecting') return;
        }
        clearRequest();
    }

    function joinDual(request) {
        if (joining) return;
        joining = true;
        const params = new URLSearchParams({
            mode: request.config?.mode || 'time',
            amount: String(request.config?.amount || 30),
            lang: request.config?.lang || 'english',
            punct: request.config?.punct || '0',
            nums: request.config?.nums || '1',
            opponent: request.friendName || request.config?.opponent || 'Opponent',
            avatar: request.config?.avatar || ''
        });
        // Clear after we've committed to navigation so a tick can't race it.
        clearRequest();
        const qs = params.toString();
        if (typeof window.navigateTo === 'function') {
            window.navigateTo('/dual?' + qs);
            // dual.js stays loaded in the SPA shell; release the guard after navigation.
            setTimeout(function () { joining = false; }, 500);
        } else {
            window.location.href = 'dual.html?' + qs;
        }
    }

    function resetJoining() {
        joining = false;
    }

    function stopTicker() {
        if (tickTimer) {
            _nativeClearInterval(tickTimer);
            tickTimer = null;
        }
    }

    function startTicker() {
        stopTicker();
        tickTimer = _nativeSetInterval(() => {
            try {
            // Rehydrate from localStorage if memory was wiped externally
            if (!memoryRequest) {
                try {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (raw) memoryRequest = JSON.parse(raw);
                } catch { /* ignore */ }
            }
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
            } catch (e) {
                console.warn('DualMatch ticker', e);
            }
        }, TICK_MS);
    }

    function sendRequest(friendName, config) {
        const data = {
            mode: 'challenge',
            friendName,
            status: 'pending',
            sentAt: now(),
            acceptedAt: null,
            config: config || {}
        };
        joining = false;
        saveRequest(data);
        renderAll();
        startTicker();
        return data;
    }

    function sendMatchmaking(config) {
        const opponent = randomOpponentName();
        const data = {
            mode: 'matchmaking',
            status: 'searching',
            sentAt: now(),
            foundAt: null,
            config: Object.assign({}, config || {}, { opponent })
        };
        joining = false;
        saveRequest(data);
        // Persist a durable mark so even a stale dual.js can't mistreat this.
        try {
            localStorage.setItem(STORAGE_KEY + '_active', String(now()));
        } catch { /* ignore */ }
        renderAll();
        startTicker();
        return data;
    }

    window.DualMatch = {
        sendRequest,
        sendMatchmaking,
        clearRequest: clearRequestSafe,
        loadRequest,
        getPhase: () => getPhase(ensureAccepted(loadRequest())),
        refresh: renderAll,
        _stopTicker: stopTicker,
        _resetJoining: resetJoining,
        version: SCRIPT_VERSION
    };

    function boot() {
        document.querySelectorAll('.friend-card').forEach(card => {
            const name = card.querySelector('h3')?.textContent?.trim();
            if (name) card.dataset.friendName = name;
        });

        renderAll();
        if (loadRequest()) startTicker();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        // Prefer keeping our in-memory matchmaking session if another tab
        // (running an older dual.js) tried to wipe localStorage.
        if (!e.newValue && isMatchmakingRequest(memoryRequest)) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryRequest)); } catch { /* ignore */ }
            renderAll();
            return;
        }
        if (e.newValue) {
            try { memoryRequest = JSON.parse(e.newValue); } catch { memoryRequest = null; }
        } else if (!memoryRequest) {
            memoryRequest = null;
        }
        renderAll();
    });
})();
