/**
 * Mobile client helpers — soft-keyboard typing + desktop-only multiplayer.
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

    /** @returns {boolean} true when the action should be blocked */
    function blockMultiplayerIfMobile() {
        if (!isMobileClient()) return false;
        notifyDesktopOnly();
        return true;
    }

    global.usertypoMobile = {
        isMobileClient: isMobileClient,
        isMultiplayerPath: isMultiplayerPath,
        blockMultiplayerIfMobile: blockMultiplayerIfMobile,
        notifyDesktopOnly: notifyDesktopOnly,
        DESKTOP_ONLY_MESSAGE: DESKTOP_ONLY_MESSAGE,
    };
})(typeof window !== 'undefined' ? window : globalThis);
