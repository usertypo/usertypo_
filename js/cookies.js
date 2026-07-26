/**
 * Cookie helpers + consent preference API.
 * Public: window.usertypoCookies, window.usertypoConsent
 *
 * Choice model:
 * - Accept all → analytics + advertising on
 * - Essential only → analytics off (GA4 not loaded); advertising still on
 */
(function () {
    var CONSENT_KEY = 'usertypo_consent';
    var THEME_BOOT_KEY = 'usertypo_theme_boot';
    var MAX_AGE_YEAR = 60 * 60 * 24 * 365;
    var listeners = [];

    function isSecureContext() {
        try {
            return location.protocol === 'https:' || location.hostname === 'localhost';
        } catch (e) {
            return false;
        }
    }

    function get(name) {
        try {
            var parts = String(document.cookie || '').split(';');
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i].trim();
                if (!part) continue;
                var eq = part.indexOf('=');
                var key = eq >= 0 ? part.slice(0, eq) : part;
                if (key !== name) continue;
                var raw = eq >= 0 ? part.slice(eq + 1) : '';
                try {
                    return decodeURIComponent(raw);
                } catch (e) {
                    return raw;
                }
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function set(name, value, options) {
        options = options || {};
        var maxAge = options.maxAge != null ? options.maxAge : MAX_AGE_YEAR;
        var parts = [
            encodeURIComponent(name) + '=' + encodeURIComponent(String(value)),
            'Path=' + (options.path || '/'),
            'Max-Age=' + String(maxAge),
            'SameSite=' + (options.sameSite || 'Lax'),
        ];
        if (options.secure !== false && isSecureContext()) parts.push('Secure');
        try {
            document.cookie = parts.join('; ');
            return true;
        } catch (e) {
            return false;
        }
    }

    function remove(name) {
        return set(name, '', { maxAge: 0 });
    }

    function normalizeConsent(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var hasAck = raw.acknowledged === true
            || raw.v === 1
            || raw.v === 2
            || raw.v === 3
            || typeof raw.analytics === 'boolean';
        if (!hasAck && raw.acknowledged !== true) return null;
        return {
            v: 3,
            acknowledged: true,
            // Default analytics on for older "always on" v2 cookies that omitted a false flag
            analytics: raw.analytics !== false,
            advertising: true,
        };
    }

    function getConsent() {
        var raw = get(CONSENT_KEY);
        if (!raw) return null;
        try {
            return normalizeConsent(JSON.parse(raw));
        } catch (e) {
            return null;
        }
    }

    function hasChoice() {
        var c = getConsent();
        return !!(c && c.acknowledged);
    }

    function notify(consent) {
        listeners.slice().forEach(function (fn) {
            try { fn(consent); } catch (err) {
                console.error('[usertypo consent] listener error', err);
            }
        });
    }

    function setConsent(partial) {
        var analytics = !(partial && partial.analytics === false);
        var next = {
            v: 3,
            acknowledged: true,
            analytics: analytics,
            advertising: true,
        };
        set(CONSENT_KEY, JSON.stringify(next));
        notify(next);
        return next;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function unsubscribe() {
            listeners = listeners.filter(function (f) { return f !== fn; });
        };
    }

    function openSettings() {
        try {
            window.dispatchEvent(new CustomEvent('usertypo:cookie-settings'));
        } catch (e) { /* ignore */ }
    }

    function writeThemeBoot(palette) {
        if (!palette || typeof palette !== 'object') return false;
        var payload = {
            n: String(palette.name || palette.n || ''),
            bg: String(palette.bgMain || palette.bg || ''),
            bs: String(palette.bgSecondary || palette.bs || ''),
            tp: String(palette.textPrimary || palette.tp || ''),
            tm: String(palette.textMuted || palette.tm || ''),
            ap: String(palette.accentPrimary || palette.ap || ''),
            ah: String(palette.accentHover || palette.ah || ''),
            er: String(palette.error || palette.er || ''),
            l: palette.isLight || palette.l ? 1 : 0,
        };
        if (!payload.bg || !payload.ap) return false;
        try {
            return set(THEME_BOOT_KEY, JSON.stringify(payload));
        } catch (e) {
            return false;
        }
    }

    function readThemeBoot() {
        var raw = get(THEME_BOOT_KEY);
        if (!raw) return null;
        try {
            var p = JSON.parse(raw);
            if (!p || !p.bg || !p.ap) return null;
            return {
                name: p.n || '',
                bgMain: p.bg,
                bgSecondary: p.bs || p.bg,
                textPrimary: p.tp || '#cccccc',
                textMuted: p.tm || '#777777',
                accentPrimary: p.ap,
                accentHover: p.ah || p.ap,
                error: p.er || '#ff4444',
                isLight: !!p.l,
            };
        } catch (e) {
            return null;
        }
    }

    window.usertypoCookies = {
        get: get,
        set: set,
        remove: remove,
        THEME_BOOT_KEY: THEME_BOOT_KEY,
        CONSENT_KEY: CONSENT_KEY,
        writeThemeBoot: writeThemeBoot,
        readThemeBoot: readThemeBoot,
    };

    window.usertypoConsent = {
        get: getConsent,
        set: setConsent,
        hasChoice: hasChoice,
        onChange: onChange,
        openSettings: openSettings,
    };
})();
