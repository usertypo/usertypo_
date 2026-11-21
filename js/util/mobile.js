/**
 * Mobile client helpers — soft-keyboard typing, multiplayer access and the
 * small phone icon (inline SVG) shown beside phone/tablet players' names in multiplayer.
 */
(function (global) {
    'use strict';

    var MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;
    var MULTIPLAYER_PATHS = {
        '/multiplayer': true,
        '/room': true,
        '/dual': true,
    };
    var DESKTOP_ONLY_MESSAGE = 'Multiplayer is currently only available on PC';
    // Phones/tablets may join multiplayer; flip to false to make it desktop-only again.
    var MULTIPLAYER_ON_MOBILE = true;

    function isMobileClient() {
        try {
            if (typeof navigator !== 'undefined' && MOBILE_UA.test(navigator.userAgent || '')) {
                return true;
            }
            var coarse = global.matchMedia && global.matchMedia('(pointer: coarse)').matches;
            var noHover = global.matchMedia && global.matchMedia('(hover: none)').matches;
            if (coarse && noHover) return true;
            if (
                typeof navigator !== 'undefined'
                && (navigator.maxTouchPoints || 0) > 1
                && noHover
            ) {
                return true;
            }
        } catch (_) { /* ignore */ }
        return false;
    }

    /** Android soft keyboards need beforeinput/input; iOS keydowns are reliable. */
    function isAndroidClient() {
        try {
            return typeof navigator !== 'undefined'
                && /Android/i.test(navigator.userAgent || '');
        } catch (_) {
            return false;
        }
    }

    function normalizePath(path) {
        var p = String(path || '').split('?')[0];
        if (!p) return '/';
        if (p.charAt(0) !== '/') p = '/' + p;
        if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
        return p;
    }

    function isMultiplayerPath(path) {
        return !!MULTIPLAYER_PATHS[normalizePath(path)];
    }

    function notifyDesktopOnly() {
        if (global.usertypoNotifications && typeof global.usertypoNotifications.showToast === 'function') {
            // Use 'error' — it's in the Material Symbols subset and styles the toast red.
            global.usertypoNotifications.showToast(DESKTOP_ONLY_MESSAGE, 'error');
            return;
        }
        try { global.alert(DESKTOP_ONLY_MESSAGE); } catch (_) { /* ignore */ }
    }

    /** True when this device may not use multiplayer. */
    function isMultiplayerBlocked() {
        return !MULTIPLAYER_ON_MOBILE && isMobileClient();
    }

    /** @returns {boolean} true when the action should be blocked */
    function blockMultiplayerIfMobile() {
        if (!isMultiplayerBlocked()) return false;
        notifyDesktopOnly();
        return true;
    }

    var DEVICE_BADGE_TITLE = 'Playing on a phone or tablet';

    /** HTML for the small phone icon shown beside a mobile player's name ('' otherwise). */
    function deviceBadgeHtml(isMobile) {
        if (!isMobile) return '';
        return '<span class="mp-device-badge" title="' + DEVICE_BADGE_TITLE + '" aria-label="' + DEVICE_BADGE_TITLE + '">'
            + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            + '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>'
            + '<line x1="10.5" y1="18" x2="13.5" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
            + '</svg></span>';
    }

    /** DOM version of deviceBadgeHtml (null when not mobile). */
    function createDeviceBadge(isMobile) {
        if (!isMobile) return null;
        var wrap = document.createElement('span');
        wrap.innerHTML = deviceBadgeHtml(true);
        return wrap.firstChild;
    }

    global.usertypoMobile = {
        isMobileClient: isMobileClient,
        isAndroidClient: isAndroidClient,
        isMultiplayerPath: isMultiplayerPath,
        isMultiplayerBlocked: isMultiplayerBlocked,
        blockMultiplayerIfMobile: blockMultiplayerIfMobile,
        deviceBadgeHtml: deviceBadgeHtml,
        createDeviceBadge: createDeviceBadge,
        notifyDesktopOnly: notifyDesktopOnly,
        DESKTOP_ONLY_MESSAGE: DESKTOP_ONLY_MESSAGE,
    };
})(typeof window !== 'undefined' ? window : globalThis);
