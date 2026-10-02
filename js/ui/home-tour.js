/**
 * Home page quick tour — icon beside "esc - quick settings" that opens a
 * glass info box (same material as the settings "How it works" portal) with
 * slides that spotlight parts of the page.
 *
 * Dismissal: signed-in users → permanent (Clerk unsafeMetadata + localStorage
 * per user id). Guests → current browser session only.
 *
 * Public API: window.usertypoHomeTour
 */
(function () {
    var META_KEY = 'homeTourDismissed';
    var LOCAL_PREFIX = 'usertypo_home_tour_dismissed:';
    var GUEST_SESSION_KEY = 'usertypo_home_tour_hidden';
    var AUTH_FALLBACK_MS = 4000;
    var GAP = 12;
    var PAD = 8;
    var RING = 6;

    /**
     * Guard flag — set to true while an activate() function is running so that
     * synthetic clicks (e.g. toggle.click() for the bubble menu) don't reach
     * onDocumentClick and close the tour.
     */
    var tourActivating = false;

    var SLIDES = [
        {
            icon: 'tune',
            title: 'Configuration',
            body: 'The slim bar on the right edge is your configuration box. Hover it to toggle punctuation and numbers, turn on adapt &amp; refine, switch between time and words, and pick a length &mdash; or go infinite / custom.',
            targets: function () {
                return [document.querySelector('#config-bar > div')];
            },
            activate: function () {
                var bar = document.getElementById('config-bar');
                if (bar && !bar.classList.contains('is-open')) {
                    bar.classList.add('is-open');
                    return function () { bar.classList.remove('is-open'); };
                }
                return null;
            },
        },
        {
            icon: 'palette',
            title: 'Sounds, themes &amp; languages',
            body: 'Bottom-right of the footer: the speaker icon mutes or unmutes typing sounds, and the pill opens the <b>Themes and Languages</b> picker to switch color themes and test languages instantly. Sound packs and more live in Settings.',
            targets: function () {
                var mute = document.querySelector('#test-view-footer .footer-mute-btn');
                return [mute && mute.parentElement];
            },
        },
        {
            icon: 'swords',
            title: 'Multiplayer',
            body: 'Open the menu at the top-left and choose <b>Multiplayer</b> to race friends or other typists in real time. Friends and Leaderboards live in the same menu.',
            targets: function () {
                return [document.getElementById('expanding-bubble')];
            },
            activate: function () {
                var bubble = document.getElementById('expanding-bubble');
                var toggle = document.getElementById('bubble-toggle');
                if (bubble && toggle && !bubble.classList.contains('is-open')) {
                    tourActivating = true;
                    toggle.click();
                    tourActivating = false;
                    bubble._tourNoAutoClose = true;
                    return function () {
                        bubble._tourNoAutoClose = false;
                        if (typeof bubble.usertypoBubbleClose === 'function') {
                            bubble.usertypoBubbleClose();
                        }
                    };
                }
                return null;
            },
        },
        {
            icon: 'forum',
            title: 'Community',
            body: 'Join the community on <b>X</b>, <b>Reddit</b> and <b>Discord</b> from the footer icons. usertypo_ is open source &mdash; fork the code on <b>GitHub</b> and make it your own.',
            targets: function () {
                return Array.prototype.slice.call(
                    document.querySelectorAll('#test-view-footer .footer-socials .footer-social-btn')
                );
            },
        },
        {
            icon: 'mail',
            title: 'Feedback',
            body: 'Found a bug or have an idea? Click <b>Contact</b> in the footer and tell us &mdash; your feedback helps make usertypo_ a better experience for everyone.',
            targets: function () {
                return [document.querySelector('#test-view-footer .footer-contact-btn')];
            },
        },
    ];

    var popover = null;
    var spotlight = null;
    var activeTrigger = null;
    var slideIndex = 0;
    var isOpen = false;
    var authResolved = false;
    var activeDeactivator = null;
    var spotlightRafId = null;

    function getAuthState() {
        var auth = window.usertypoAuth;
        if (!auth || typeof auth.getState !== 'function') return { isSignedIn: false, user: null };
        try { return auth.getState(); } catch (e) { return { isSignedIn: false, user: null }; }
    }

    function readStorage(storage, key) {
        try { return storage.getItem(key); } catch (e) { return null; }
    }

    function writeStorage(storage, key, value) {
        try { storage.setItem(key, value); } catch (e) { /* ignore */ }
    }

    function isDismissed() {
        var state = getAuthState();
        if (state.isSignedIn && state.user) {
            if (readStorage(localStorage, LOCAL_PREFIX + state.user.id) === '1') return true;
            var meta = state.user.unsafeMetadata;
            return !!(meta && meta[META_KEY]);
        }
        return readStorage(sessionStorage, GUEST_SESSION_KEY) === '1';
    }

    function getWraps() {
        return document.querySelectorAll('[data-home-tour]');
    }

    function sync() {
        var show = authResolved && !isDismissed();
        getWraps().forEach(function (wrap) {
            if (show) {
                wrap.hidden = false;
                wrap.classList.remove('is-leaving');
            } else if (!wrap.classList.contains('is-leaving')) {
                wrap.hidden = true;
            }
        });
        if (isOpen && (!show || !activeTrigger || !document.body.contains(activeTrigger))) {
            close();
        }
    }

    function dismiss(wrap) {
        close();
        var state = getAuthState();
        if (state.isSignedIn && state.user) {
            var user = state.user;
            writeStorage(localStorage, LOCAL_PREFIX + user.id, '1');
            if (typeof user.update === 'function') {
                var meta = Object.assign({}, user.unsafeMetadata || {});
                meta[META_KEY] = true;
                user.update({ unsafeMetadata: meta }).catch(function (err) {
                    console.warn('[usertypo home tour] could not save dismissal to account', err);
                });
            }
        } else {
            writeStorage(sessionStorage, GUEST_SESSION_KEY, '1');
        }

        if (wrap) {
            wrap.classList.add('is-leaving');
            setTimeout(function () {
                wrap.classList.remove('is-leaving');
                sync();
            }, 220);
        } else {
            sync();
        }
    }

    function ensurePopover() {
        if (popover && document.body.contains(popover)) return popover;

        spotlight = document.createElement('div');
        spotlight.id = 'home-tour-spotlight';
        spotlight.setAttribute('aria-hidden', 'true');
        document.body.appendChild(spotlight);

        popover = document.createElement('div');
        popover.id = 'home-tour-popover';
        popover.className = 'glass-panel bg-surface/85 !backdrop-blur-sm';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-labelledby', 'home-tour-title');
        popover.setAttribute('aria-hidden', 'true');
        popover.innerHTML =
            '<div class="home-tour-slide">' +
                '<div class="home-tour-title" id="home-tour-title">' +
                    '<span class="material-symbols-outlined" data-home-tour-icon aria-hidden="true">info</span>' +
                    '<span data-home-tour-heading></span>' +
                '</div>' +
                '<div class="home-tour-body" data-home-tour-body></div>' +
            '</div>' +
            '<div class="home-tour-nav">' +
                '<button type="button" class="home-tour-nav-btn" data-home-tour-prev aria-label="Previous tip">' +
                    '<span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>' +
                '</button>' +
                '<div class="home-tour-dots" data-home-tour-dots></div>' +
                '<button type="button" class="home-tour-nav-btn home-tour-next-btn" data-home-tour-next aria-label="Next tip">' +
                    '<span class="material-symbols-outlined" data-home-tour-next-icon aria-hidden="true">chevron_right</span>' +
                    '<kbd class="home-tour-enter-hint" aria-hidden="true">↵</kbd>' +
                '</button>' +
            '</div>';
        document.body.appendChild(popover);

        var dots = popover.querySelector('[data-home-tour-dots]');
        SLIDES.forEach(function (_, i) {
            var dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'home-tour-dot';
            dot.setAttribute('aria-label', 'Go to tip ' + (i + 1));
            dot.addEventListener('click', function () { goTo(i); });
            dots.appendChild(dot);
        });

        popover.querySelector('[data-home-tour-prev]').addEventListener('click', function () {
            goTo(slideIndex - 1);
        });
        popover.querySelector('[data-home-tour-next]').addEventListener('click', function () {
            if (slideIndex >= SLIDES.length - 1) close();
            else goTo(slideIndex + 1);
        });

        return popover;
    }

    function deactivateSlide() {
        if (activeDeactivator) {
            try { activeDeactivator(); } catch (e) { /* ignore */ }
            activeDeactivator = null;
        }
    }

    function activateSlide() {
        deactivateSlide();
        var slide = SLIDES[slideIndex];
        if (slide && typeof slide.activate === 'function') {
            activeDeactivator = slide.activate();
        }
    }

    function renderSlideContent() {
        var slide = SLIDES[slideIndex];
        var last = slideIndex === SLIDES.length - 1;

        popover.querySelector('[data-home-tour-icon]').textContent = slide.icon;
        popover.querySelector('[data-home-tour-heading]').innerHTML = slide.title;
        popover.querySelector('[data-home-tour-body]').innerHTML = slide.body;

        var prev = popover.querySelector('[data-home-tour-prev]');
        prev.disabled = slideIndex === 0;

        var next = popover.querySelector('[data-home-tour-next]');
        popover.querySelector('[data-home-tour-next-icon]').textContent = last ? 'check' : 'chevron_right';
        next.setAttribute('aria-label', last ? 'Finish tour' : 'Next tip');
        next.classList.toggle('is-finish', last);

        popover.querySelectorAll('.home-tour-dot').forEach(function (dot, i) {
            dot.classList.toggle('is-active', i === slideIndex);
            if (i === slideIndex) dot.setAttribute('aria-current', 'step');
            else dot.removeAttribute('aria-current');
        });
    }

    /* ── Spotlight tracking ─────────────────────────────────────── */

    /**
     * Start a requestAnimationFrame loop that re-measures the target element
     * every frame for `durationMs`, keeping the spotlight perfectly in sync
     * with CSS transitions (config-bar expand, bubble open, etc.).
     * The spotlight's own CSS transitions are suppressed during tracking.
     */
    function startTrackingSpotlight(durationMs) {
        stopTrackingSpotlight();
        if (spotlight) spotlight.style.transition = 'opacity 0.2s ease';

        var startTime = performance.now();
        function tick() {
            if (!isOpen) { stopTrackingSpotlight(); return; }
            positionSpotlight();
            if (performance.now() - startTime < durationMs) {
                spotlightRafId = requestAnimationFrame(tick);
            } else {
                /* Tracking done — restore CSS transitions and do a final position */
                if (spotlight) spotlight.style.transition = '';
                position();
            }
        }
        spotlightRafId = requestAnimationFrame(tick);
    }

    function stopTrackingSpotlight() {
        if (spotlightRafId) {
            cancelAnimationFrame(spotlightRafId);
            spotlightRafId = null;
        }
        if (spotlight) spotlight.style.transition = '';
    }

    /* ── End spotlight tracking ──────────────────────────────────── */

    function renderSlide(animate) {
        renderSlideContent();

        if (animate) {
            var content = popover.querySelector('.home-tour-slide');
            content.classList.remove('is-entering');
            void content.offsetWidth;
            content.classList.add('is-entering');
        }

        activateSlide();

        var slide = SLIDES[slideIndex];
        if (typeof slide.activate === 'function') {
            /*
             * This slide activates (expands) a UI element.  Use rAF tracking
             * so the spotlight expands in lock-step with the element.
             * 600ms covers config-bar (500ms) and bubble (400ms) transitions.
             */
            startTrackingSpotlight(600);
            /* Also update popover position after element finishes expanding */
            setTimeout(function () { position(); }, 550);
        } else {
            /* Static target — use CSS transition for smooth spotlight glide */
            position();
        }
    }

    function goTo(index) {
        var clamped = Math.max(0, Math.min(SLIDES.length - 1, index));
        if (clamped === slideIndex) return;
        slideIndex = clamped;
        renderSlide(true);
    }

    function unionRect(elements) {
        var rect = null;
        elements.forEach(function (el) {
            if (!el) return;
            var r = el.getBoundingClientRect();
            if (!r.width && !r.height) return;
            if (!rect) {
                rect = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
            } else {
                rect.top = Math.min(rect.top, r.top);
                rect.left = Math.min(rect.left, r.left);
                rect.right = Math.max(rect.right, r.right);
                rect.bottom = Math.max(rect.bottom, r.bottom);
            }
        });
        return rect;
    }

    /**
     * Find the first non-null element in the targets array.
     */
    function firstTarget(targets) {
        if (!targets) return null;
        for (var i = 0; i < targets.length; i++) {
            if (targets[i]) return targets[i];
        }
        return null;
    }

    function positionSpotlight() {
        if (!spotlight) return;
        var targets = isOpen ? SLIDES[slideIndex].targets() : null;
        var rect = targets ? unionRect(targets) : null;
        if (!rect) {
            spotlight.classList.remove('visible');
            return;
        }

        /* Match the target element's border-radius so the highlight ring
           follows the same corner curvature as the actual element */
        var el = firstTarget(targets);
        if (el) {
            var cs = getComputedStyle(el);
            var tl = parseFloat(cs.borderTopLeftRadius) || 0;
            var tr = parseFloat(cs.borderTopRightRadius) || 0;
            var br = parseFloat(cs.borderBottomRightRadius) || 0;
            var bl = parseFloat(cs.borderBottomLeftRadius) || 0;
            /* Add the ring offset to non-zero corners so the curve stays
               concentric with the element's own corners */
            spotlight.style.borderRadius =
                (tl ? tl + RING : 0) + 'px ' +
                (tr ? tr + RING : 0) + 'px ' +
                (br ? br + RING : 0) + 'px ' +
                (bl ? bl + RING : 0) + 'px';
        }

        spotlight.style.top = (rect.top - RING) + 'px';
        spotlight.style.left = (rect.left - RING) + 'px';
        spotlight.style.width = (rect.right - rect.left + RING * 2) + 'px';
        spotlight.style.height = (rect.bottom - rect.top + RING * 2) + 'px';
        spotlight.classList.add('visible');
    }

    function position() {
        if (!popover || !isOpen) return;

        var targets = SLIDES[slideIndex].targets();
        var targetRect = unionRect(targets);

        if (!targetRect && activeTrigger) {
            targetRect = activeTrigger.getBoundingClientRect();
        }
        if (!targetRect) return;

        var w = popover.offsetWidth;
        var h = popover.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        var targetCenterX = (targetRect.left + targetRect.right) / 2;
        var targetCenterY = (targetRect.top + targetRect.bottom) / 2;

        var top, left;

        // Left of target
        if (targetRect.left - GAP - w > PAD) {
            left = targetRect.left - GAP - w;
            top = targetCenterY - h / 2;
        }
        // Right of target
        else if (targetRect.right + GAP + w < vw - PAD) {
            left = targetRect.right + GAP;
            top = targetCenterY - h / 2;
        }
        // Above target
        else if (targetRect.top - GAP - h > PAD) {
            top = targetRect.top - GAP - h;
            left = targetCenterX - w / 2;
        }
        // Below target
        else {
            top = targetRect.bottom + GAP;
            left = targetCenterX - w / 2;
        }

        // Clamp within viewport
        if (top < PAD) top = PAD;
        else if (top + h > vh - PAD) top = Math.max(PAD, vh - PAD - h);
        if (left < PAD) left = PAD;
        else if (left + w > vw - PAD) left = vw - PAD - w;

        popover.style.top = top + 'px';
        popover.style.left = left + 'px';

        positionSpotlight();
    }

    function open(trigger) {
        ensurePopover();
        activeTrigger = trigger;
        slideIndex = 0;
        isOpen = true;

        trigger.setAttribute('aria-expanded', 'true');
        trigger.closest('[data-home-tour]').classList.add('is-open');

        renderSlideContent();

        /* Position before showing (suppress glide from 0,0) */
        popover.style.transition = 'none';
        if (spotlight) spotlight.style.transition = 'none';
        position();
        void popover.offsetWidth;

        popover.classList.add('visible');
        popover.setAttribute('aria-hidden', 'false');

        requestAnimationFrame(function () {
            if (popover) popover.style.transition = '';
            if (spotlight) spotlight.style.transition = '';
        });

        trigger.blur();

        /* Activate element and track spotlight in sync via rAF */
        activateSlide();

        var slide = SLIDES[slideIndex];
        if (typeof slide.activate === 'function') {
            startTrackingSpotlight(600);
            setTimeout(function () { position(); }, 550);
        }
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        stopTrackingSpotlight();
        deactivateSlide();
        if (popover) {
            popover.classList.remove('visible');
            popover.setAttribute('aria-hidden', 'true');
        }
        if (spotlight) spotlight.classList.remove('visible');
        if (activeTrigger) {
            activeTrigger.setAttribute('aria-expanded', 'false');
            var wrap = activeTrigger.closest('[data-home-tour]');
            if (wrap) wrap.classList.remove('is-open');
        }
        activeTrigger = null;
    }

    function onDocumentClick(e) {
        if (tourActivating) return;

        var target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        var dismissBtn = target.closest('[data-home-tour-dismiss]');
        if (dismissBtn) {
            e.preventDefault();
            e.stopPropagation();
            dismiss(dismissBtn.closest('[data-home-tour]'));
            return;
        }

        var trigger = target.closest('[data-home-tour-trigger]');
        if (trigger) {
            e.preventDefault();
            if (isOpen && activeTrigger === trigger) close();
            else open(trigger);
            return;
        }

        if (isOpen && popover && !popover.contains(target)) close();
    }

    function onKeyDown(e) {
        if (!isOpen) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
            return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopImmediatePropagation();
            goTo(slideIndex + (e.key === 'ArrowRight' ? 1 : -1));
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (slideIndex >= SLIDES.length - 1) {
                close();
            } else {
                goTo(slideIndex + 1);
            }
            return;
        }
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        var focused = document.activeElement;
        var focusInTour = focused && ((popover && popover.contains(focused)) || focused === activeTrigger);
        if (focusInTour && (e.key === ' ' || e.key === 'Tab')) return;
        close();
    }

    function onViewportChange() {
        if (isOpen) position();
    }

    function markAuthResolved() {
        if (authResolved) {
            sync();
            return;
        }
        authResolved = true;
        sync();
    }

    function init() {
        document.addEventListener('click', onDocumentClick, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);

        var bubble = document.getElementById('expanding-bubble');
        if (bubble) {
            bubble.addEventListener('mouseleave', function (e) {
                if (bubble._tourNoAutoClose) {
                    e.stopImmediatePropagation();
                }
            }, true);
        }

        var auth = window.usertypoAuth;
        if (auth && typeof auth.onChange === 'function') {
            auth.onChange(markAuthResolved);
            if (typeof auth.ready === 'function') {
                auth.ready().then(markAuthResolved, markAuthResolved);
            }
            setTimeout(markAuthResolved, AUTH_FALLBACK_MS);
        } else {
            markAuthResolved();
        }
    }

    window.usertypoHomeTour = {
        sync: sync,
        close: close,
        dismiss: function () { dismiss(document.querySelector('[data-home-tour]')); },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
