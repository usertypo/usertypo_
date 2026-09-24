/**
 * Sync Look & Feel (themes) to the signed-in account via profiles.look_feel.
 * Guests stay local-only. Last-write-wins via updatedAt.
 * Public API: window.usertypoLookFeel
 */
(function () {
    var LOOK_FEEL_VERSION = 1;
    var PUSH_DEBOUNCE_MS = 700;
    var pushTimer = null;
    var syncInFlight = null;
    var applyingFromCloud = false;
    var lastBoundUserId = null;
    var started = false;

    function isSignedIn() {
        try {
            if (!window.usertypoAuth || typeof window.usertypoAuth.getState !== 'function') return false;
            var state = window.usertypoAuth.getState();
            return !!(state && state.isSignedIn && state.user && state.user.id);
        } catch (e) {
            return false;
        }
    }

    function currentUserId() {
        try {
            var state = window.usertypoAuth && window.usertypoAuth.getState
                ? window.usertypoAuth.getState()
                : null;
            return state && state.user ? state.user.id : null;
        } catch (e) {
            return null;
        }
    }

    function loadLocalSettings() {
        if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.loadSettings === 'function') {
            return window.usertypo_settingsApi.loadSettings();
        }
        return window.usertypo_settings || null;
    }

    function saveLocalSettings(settings) {
        if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.saveSettings === 'function') {
            window.usertypo_settingsApi.saveSettings(settings);
            return;
        }
        try {
            window.localStorage.setItem('usertypo_settings', JSON.stringify(settings));
            window.usertypo_settings = settings;
        } catch (e) { /* ignore */ }
    }

    function normalizeBgImage(raw) {
        if (window.usertypoThemeBgEditor && typeof window.usertypoThemeBgEditor.normalizeBgImage === 'function') {
            var normalized = window.usertypoThemeBgEditor.normalizeBgImage(raw);
            if (!normalized) return null;
            if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.normalizeDurableUrl === 'function') {
                normalized = Object.assign({}, normalized, {
                    url: window.usertypoThemeAssets.normalizeDurableUrl(normalized.url),
                });
            }
            return normalized;
        }
        if (!raw || typeof raw !== 'object' || !raw.url) return null;
        var url = String(raw.url);
        if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.normalizeDurableUrl === 'function') {
            url = window.usertypoThemeAssets.normalizeDurableUrl(url);
        }
        return {
            id: String(raw.id || 'custom'),
            url: url,
            opacity: Math.max(0.05, Math.min(1, Number(raw.opacity) || 0.75)),
            zoom: Math.max(1, Math.min(3, Number(raw.zoom) || 1)),
            offsetX: Math.max(0, Math.min(1, Number.isFinite(Number(raw.offsetX)) ? Number(raw.offsetX) : 0.5)),
            offsetY: Math.max(0, Math.min(1, Number.isFinite(Number(raw.offsetY)) ? Number(raw.offsetY) : 0.5)),
        };
    }

    /** Cloud must never store data:/blob: — those wipe other devices when truncated/rejected. */
    function cloudSafeBgImage(raw) {
        var bg = normalizeBgImage(raw);
        if (!bg || !bg.url) return null;
        if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.isEphemeralUrl === 'function') {
            if (window.usertypoThemeAssets.isEphemeralUrl(bg.url)) return null;
        } else {
            var u = String(bg.url);
            if (u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return null;
        }
        return bg;
    }

    function themeHasEphemeralImage(theme) {
        var bg = theme && theme.bgImage;
        if (!bg || !bg.url) return false;
        if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.isEphemeralUrl === 'function') {
            return window.usertypoThemeAssets.isEphemeralUrl(bg.url);
        }
        var u = String(bg.url);
        return u.indexOf('data:') === 0 || u.indexOf('blob:') === 0;
    }

    function normalizeCustomTheme(raw) {
        if (!raw || typeof raw !== 'object') {
            return {
                mode: 'Dark',
                mainColor: '#ffffff',
                secondaryColor: '#cccccc',
                bgColor: '#000000',
                bgSpectrumPos: 0,
                bgImage: null,
            };
        }
        var mode = String(raw.mode || 'Dark').toLowerCase() === 'light' ? 'Light' : 'Dark';
        return {
            mode: mode,
            mainColor: String(raw.mainColor || '#ffffff'),
            secondaryColor: String(raw.secondaryColor || '#cccccc'),
            bgColor: String(raw.bgColor || (mode === 'Light' ? '#ffffff' : '#000000')),
            bgSpectrumPos: Number.isFinite(Number(raw.bgSpectrumPos))
                ? Number(raw.bgSpectrumPos)
                : 0,
            bgImage: normalizeBgImage(raw.bgImage),
        };
    }

    function normalizePresets(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.slice(0, 3).map(function (p, i) {
            var theme = normalizeCustomTheme(p);
            return {
                name: (p && p.name && String(p.name).trim()) || ('Custom ' + (i + 1)),
                mode: theme.mode,
                mainColor: theme.mainColor,
                secondaryColor: theme.secondaryColor,
                bgColor: theme.bgColor,
                bgSpectrumPos: theme.bgSpectrumPos,
                bgImage: theme.bgImage,
            };
        });
    }

    function glowFrom(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return 50;
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    function buildPayloadFromLocal(settings, updatedAt) {
        var lf = (settings && settings.lookFeel) || {};
        var customTheme = normalizeCustomTheme(lf.customTheme);
        customTheme.bgImage = cloudSafeBgImage(customTheme.bgImage);
        var presets = normalizePresets(lf.customPresets).map(function (p) {
            return Object.assign({}, p, { bgImage: cloudSafeBgImage(p.bgImage) });
        });
        return {
            v: LOOK_FEEL_VERSION,
            updatedAt: Number(updatedAt) || Date.now(),
            colorTheme: lf.colorTheme || 'Abyss',
            fontFamily: lf.fontFamily || 'JetBrains Mono',
            randomizeTheme: lf.randomizeTheme || 'Off',
            glowIntensity: glowFrom(lf.glowIntensity),
            customTheme: customTheme,
            customPresets: presets,
        };
    }

    function parseCloudPayload(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        var updatedAt = Number(raw.updatedAt);
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
        return {
            v: LOOK_FEEL_VERSION,
            updatedAt: updatedAt,
            colorTheme: raw.colorTheme || 'Abyss',
            fontFamily: raw.fontFamily || 'JetBrains Mono',
            randomizeTheme: raw.randomizeTheme || 'Off',
            glowIntensity: glowFrom(raw.glowIntensity),
            customTheme: normalizeCustomTheme(raw.customTheme),
            customPresets: normalizePresets(raw.customPresets),
        };
    }

    function localUpdatedAt(settings) {
        var n = Number(settings && settings.lookFeel && settings.lookFeel._lookFeelUpdatedAt);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function bumpLocalUpdatedAt(settings) {
        if (!settings.lookFeel) settings.lookFeel = {};
        settings.lookFeel._lookFeelUpdatedAt = Date.now();
        return settings.lookFeel._lookFeelUpdatedAt;
    }

    function applyCloudToLocal(payload) {
        var settings = loadLocalSettings();
        if (!settings) return false;
        if (!settings.lookFeel) settings.lookFeel = {};

        applyingFromCloud = true;
        try {
            settings.lookFeel.colorTheme = payload.colorTheme;
            settings.lookFeel.fontFamily = payload.fontFamily;
            settings.lookFeel.randomizeTheme = payload.randomizeTheme;
            settings.lookFeel.glowIntensity = payload.glowIntensity;
            settings.lookFeel.customTheme = payload.customTheme;
            settings.lookFeel.customPresets = payload.customPresets;
            settings.lookFeel._lookFeelUpdatedAt = payload.updatedAt;
            saveLocalSettings(settings);

            if (typeof window.pushSharedCustomThemes === 'function') {
                try { window.pushSharedCustomThemes(settings); } catch (e) { /* ignore */ }
            } else if (
                window.usertypo_settingsApi
                && typeof window.usertypo_settingsApi.pushSharedCustomThemes === 'function'
            ) {
                try { window.usertypo_settingsApi.pushSharedCustomThemes(settings); } catch (e) { /* ignore */ }
            }

            if (window.usertypo_settingsApi) {
                if (typeof window.usertypo_settingsApi.applyAllSettings === 'function') {
                    window.usertypo_settingsApi.applyAllSettings(settings);
                }
                if (typeof window.usertypo_settingsApi.syncColorThemeSelectLabel === 'function') {
                    window.usertypo_settingsApi.syncColorThemeSelectLabel(settings);
                }
                if (typeof window.usertypo_settingsApi.syncCustomThemeEditor === 'function') {
                    window.usertypo_settingsApi.syncCustomThemeEditor(settings);
                }
                if (typeof window.usertypo_settingsApi.restoreUI === 'function') {
                    var path = (location.pathname || '');
                    if (path === '/settings' || /settings\.html/i.test(path)) {
                        try { window.usertypo_settingsApi.restoreUI(settings); } catch (e) { /* ignore */ }
                    }
                }
            }

            try {
                window.dispatchEvent(new CustomEvent('usertypo:look-feel-synced', {
                    detail: { source: 'cloud', updatedAt: payload.updatedAt },
                }));
            } catch (e) { /* ignore */ }

            return true;
        } finally {
            applyingFromCloud = false;
        }
    }

    async function fetchCloudLookFeel() {
        if (!window.usertypoDb || typeof window.usertypoDb.getClient !== 'function') {
            throw new Error('usertypoDb is not loaded');
        }
        var client = await window.usertypoDb.getClient();
        var result = await client.from('profiles').select('look_feel').maybeSingle();
        if (result.error) throw result.error;
        return parseCloudPayload(result.data && result.data.look_feel);
    }

    async function writeCloudLookFeel(payload) {
        if (!window.usertypoDb || typeof window.usertypoDb.getClient !== 'function') {
            throw new Error('usertypoDb is not loaded');
        }
        var userId = currentUserId();
        if (!userId) throw new Error('guest');

        var client = await window.usertypoDb.getClient();
        var updated = await client
            .from('profiles')
            .update({ look_feel: payload })
            .eq('user_id', userId)
            .select('look_feel')
            .maybeSingle();

        if (updated.error) throw updated.error;
        // Profile row may not exist yet (username_required) — treat as soft skip.
        if (!updated.data) return null;
        return parseCloudPayload(updated.data.look_feel) || payload;
    }

    async function ensureLocalImagesOnR2(settings) {
        if (!settings || !settings.lookFeel) return settings;
        if (!window.usertypoThemeAssets || typeof window.usertypoThemeAssets.persistBgImage !== 'function') {
            return settings;
        }
        var changed = false;
        try {
            var ct = settings.lookFeel.customTheme;
            if (ct && ct.bgImage && ct.bgImage.url) {
                var nextLive = await window.usertypoThemeAssets.persistBgImage(ct.bgImage, null);
                if (nextLive && nextLive.url && nextLive.url !== ct.bgImage.url) {
                    settings.lookFeel.customTheme = Object.assign({}, ct, { bgImage: nextLive });
                    changed = true;
                } else if (nextLive && nextLive.url) {
                    var normalizedLive = window.usertypoThemeAssets.normalizeDurableUrl
                        ? window.usertypoThemeAssets.normalizeDurableUrl(nextLive.url)
                        : nextLive.url;
                    if (normalizedLive !== ct.bgImage.url) {
                        settings.lookFeel.customTheme = Object.assign({}, ct, {
                            bgImage: Object.assign({}, nextLive, { url: normalizedLive }),
                        });
                        changed = true;
                    }
                }
            }
            var presets = Array.isArray(settings.lookFeel.customPresets)
                ? settings.lookFeel.customPresets.slice()
                : [];
            for (var i = 0; i < presets.length; i++) {
                var p = presets[i];
                if (!p || !p.bgImage || !p.bgImage.url) continue;
                var nextPreset = await window.usertypoThemeAssets.persistBgImage(p.bgImage, null);
                if (!nextPreset || !nextPreset.url) continue;
                var normalizedPreset = window.usertypoThemeAssets.normalizeDurableUrl
                    ? window.usertypoThemeAssets.normalizeDurableUrl(nextPreset.url)
                    : nextPreset.url;
                if (normalizedPreset !== p.bgImage.url) {
                    presets[i] = Object.assign({}, p, {
                        bgImage: Object.assign({}, nextPreset, { url: normalizedPreset }),
                    });
                    changed = true;
                }
            }
            if (changed) {
                settings.lookFeel.customPresets = presets;
                saveLocalSettings(settings);
            }
        } catch (err) {
            console.warn('[usertypo look-feel] R2 migrate failed', err);
        }
        return settings;
    }

    function localHasEphemeralImages(settings) {
        if (!settings || !settings.lookFeel) return false;
        if (themeHasEphemeralImage(settings.lookFeel.customTheme)) return true;
        var presets = Array.isArray(settings.lookFeel.customPresets)
            ? settings.lookFeel.customPresets
            : [];
        for (var i = 0; i < presets.length; i++) {
            if (themeHasEphemeralImage(presets[i])) return true;
        }
        return false;
    }

    async function pushNow(options) {
        if (applyingFromCloud) return null;
        if (!isSignedIn()) return null;

        var settings = loadLocalSettings();
        if (!settings) return null;
        settings = await ensureLocalImagesOnR2(settings);

        // Never push while local still has data:/blob: images — that would store null
        // (or a huge payload) and wipe other devices on the next pull.
        if (localHasEphemeralImages(settings)) {
            console.warn('[usertypo look-feel] deferring push until background images are on R2');
            return null;
        }

        var force = !!(options && options.force);
        var at = localUpdatedAt(settings);
        if (!at) {
            at = bumpLocalUpdatedAt(settings);
            saveLocalSettings(settings);
        }

        var payload = buildPayloadFromLocal(settings, at);
        var written = await writeCloudLookFeel(payload);
        if (written && !force) {
            // Keep local watermark aligned with what we wrote.
            settings = loadLocalSettings();
            if (settings && settings.lookFeel) {
                settings.lookFeel._lookFeelUpdatedAt = written.updatedAt || payload.updatedAt;
                saveLocalSettings(settings);
            }
        }
        return written || payload;
    }

    async function reconcile() {
        if (!isSignedIn()) return { action: 'skipped', reason: 'guest' };
        if (applyingFromCloud) return { action: 'skipped', reason: 'applying' };

        if (syncInFlight) return syncInFlight;

        var userId = currentUserId();
        syncInFlight = (async function () {
            try {
                // Wait briefly for profile row if we just signed up.
                var cloud = null;
                try {
                    cloud = await fetchCloudLookFeel();
                } catch (err) {
                    console.warn('[usertypo look-feel] fetch failed', err);
                    return { action: 'error', error: err };
                }

                var settings = loadLocalSettings();
                if (!settings) return { action: 'skipped', reason: 'no_settings' };

                var localAt = localUpdatedAt(settings);

                if (!cloud) {
                    // First cloud write for this account — upload local themes.
                    await pushNow({ force: true });
                    lastBoundUserId = userId;
                    return { action: 'pushed', reason: 'cloud_empty' };
                }

                if (!localAt || cloud.updatedAt > localAt) {
                    applyCloudToLocal(cloud);
                    lastBoundUserId = userId;
                    return { action: 'pulled', updatedAt: cloud.updatedAt };
                }

                if (localAt > cloud.updatedAt) {
                    await pushNow({ force: true });
                    lastBoundUserId = userId;
                    return { action: 'pushed', reason: 'local_newer' };
                }

                lastBoundUserId = userId;
                return { action: 'noop', updatedAt: localAt };
            } finally {
                syncInFlight = null;
            }
        })();

        return syncInFlight;
    }

    function schedulePush() {
        if (applyingFromCloud) return;
        if (!isSignedIn()) return;

        var settings = loadLocalSettings();
        if (settings) {
            bumpLocalUpdatedAt(settings);
            saveLocalSettings(settings);
        }

        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(function () {
            pushTimer = null;
            pushNow().catch(function (err) {
                console.warn('[usertypo look-feel] push failed', err);
            });
        }, PUSH_DEBOUNCE_MS);
    }

    /**
     * Call after any local Look & Feel mutation (theme, font, glow, etc.).
     */
    function notifyLocalChange() {
        if (applyingFromCloud) return;
        schedulePush();
    }

    function onProfileSynced() {
        if (!isSignedIn()) return;
        var userId = currentUserId();
        // Reconcile on every profile sync for this user (covers login + refresh).
        reconcile().then(function (result) {
            if (result && result.action && result.action !== 'noop' && result.action !== 'skipped') {
                console.info('[usertypo look-feel]', result.action, result.reason || result.updatedAt || '');
            }
        }).catch(function (err) {
            console.warn('[usertypo look-feel] reconcile failed', err);
        });
        void userId;
        void lastBoundUserId;
    }

    function onAuthChange() {
        if (!isSignedIn()) {
            lastBoundUserId = null;
            if (pushTimer) {
                clearTimeout(pushTimer);
                pushTimer = null;
            }
            return;
        }
        // Profile sync event usually follows; also reconcile after a short delay
        // in case profile-synced already fired with a cache hit before this module loaded.
        setTimeout(function () {
            if (isSignedIn()) onProfileSynced();
        }, 400);
    }

    function start() {
        if (started) return;
        started = true;

        window.addEventListener('usertypo:profile-synced', onProfileSynced);

        if (window.usertypoAuth && typeof window.usertypoAuth.onChange === 'function') {
            window.usertypoAuth.onChange(onAuthChange);
        }

        if (window.usertypoAuth && typeof window.usertypoAuth.ready === 'function') {
            window.usertypoAuth.ready().then(onAuthChange).catch(function () { /* ignore */ });
        } else {
            onAuthChange();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.usertypoLookFeel = {
        reconcile: reconcile,
        pushNow: pushNow,
        schedulePush: schedulePush,
        notifyLocalChange: notifyLocalChange,
        isApplyingFromCloud: function () { return applyingFromCloud; },
    };
})();
