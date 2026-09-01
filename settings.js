/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  usertypo_ Settings — State Management & Global Application
 *  Card 1: Cursor & Motion
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  How it works:
 *  - HTML controls have data-setting="cursor.caretStyle" etc.
 *  - When a control changes, we read the value and save to localStorage.
 *  - applyCursorSettings() injects a dynamic <style> tag that overrides
 *    the hardcoded #caret CSS in index.html with the saved style.
 *  - On page load (any page), the <style> tag is injected immediately,
 *    so the correct caret style is always visible.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  1. SETTINGS STORE
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'usertypo_settings';
const STAGING_GLOW_DEFAULT_FLAG = 'usertypo:stagingGlowDefault50';

function isStagingHost() {
    try {
        const host = String(location.hostname || '').toLowerCase();
        return host === 'dev.usertypo.com'
            || host === 'www.dev.usertypo.com'
            || host === 'dev.usertypo.pages.dev';
    } catch (e) {
        return false;
    }
}

function getDefaultGlowIntensity() {
    // Staging-only default for experiments; live stays at 100.
    return isStagingHost() ? 50 : 100;
}

const DEFAULTS = {
    cursor: {
        caretStyle: 'underscore', // line | block | underscore | outline
        caretSmoothness: 'medium',    // off | slow | medium | fast
        adaptiveSmoothness: false,
        paceCaretMode: 'off',       // off | average | pb | last | custom | daily
        paceCaretStyle: 'underscore', // line | block | underscore | outline
        paceCaretCustomSpeed: 100,
        repeatedPace: true,          // auto pace caret on replay at previous test speed
        smoothLineScroll: true,
        tapeMode: 'off',       // off | letter | word — shared across home, dual, and rooms
    },
    soundscape: {
        clickSounds: false,
        errorSounds: 'off', // off | mute | beep
        masterVolume: 50,
        muted: false,
        soundPack: 'Steelseries Apex Pro V2',
    },
    languageContent: {
        testLanguage: 'english',
    },
    testRules: {
        difficulty: 'Normal',
        stopOnError: 'Off',
        confidenceMode: 'Off',
        freedomMode: false,
        indicateTypos: 'Off',
        lazyMode: false,
        strictSpace: false,
        requiredCorrectEnd: false,
        capslockWarning: true,
        oppositeShift: false,
    },
    keyboardLayout: {
        keymapMode: 'Off',       // Off | Static | React | Next
        keymapStyle: 'Staggered', // Staggered | Alice | Matrix | Split
        keymapLayout: 'QWERTY',
        keymapLegend: 'Lowercase',
        keyboardShortcuts: true, // master switch for app keyboard shortcuts
        quickRestart: true,      // Tab restarts the test when shortcuts are on
        quickRestartCustomKey: '',
        quickSettings: true, // Esc opens quick settings search
    },
    resultsAndGraphs: {
        decimalPrecision: false,
        alwaysShowCPS: false,
        defaultGraphView: 'Basic',
        smoothGraphLines: true,
        startGraphFromZero: false,
        minWPM: 'Off',
        minAccuracy: '75%',
    },
    liveFeed: {
        liveWpm: true,
        liveAccuracy: true,
        liveBurst: false,
        timerStyle: 'Number',
        timerOpacity: '0.5',
    },
    lookFeel: {
        colorTheme: 'Abyss',
        fontFamily: 'JetBrains Mono',
        randomizeTheme: 'Off',
        glowIntensity: 100, // overwritten in cloneDefaults() for staging hosts (50)
        customTheme: {
            mode: 'Dark',
            mainColor: '#ffffff',
            secondaryColor: '#cccccc',
            bgColor: '#000000',
            bgSpectrumPos: 0,
        },
        customPresets: [],
    },
    systemData: {
        saveTestStats: true,
    }
};

const CUSTOM_THEME_DEFAULT = {
    mode: 'Dark',
    mainColor: '#ffffff',
    secondaryColor: '#cccccc',
    bgColor: '#000000',
    bgSpectrumPos: 0,
};
const MAX_CUSTOM_PRESETS = 3;

/** Abyss on dark OS theme, Paper on light — used for fresh defaults / reset. */
function getPreferredDefaultTheme() {
    try {
        if (typeof window !== 'undefined' && window.matchMedia
            && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'Paper';
        }
    } catch (e) { /* ignore */ }
    return 'Abyss';
}

function cloneDefaults() {
    const settings = structuredClone(DEFAULTS);
    settings.lookFeel.colorTheme = getPreferredDefaultTheme();
    settings.lookFeel.glowIntensity = getDefaultGlowIntensity();
    return settings;
}

function loadSettings() {
    let settings = cloneDefaults();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            settings = deepMerge(settings, parsed);
        }
    } catch { /* corrupt — use defaults */ }

    // Staging experiment: one-time shift to the new 50% default so existing
    // localStorage on the DEV host shows the change without wiping other settings.
    // Live site never runs this. Users can still change the slider afterward.
    if (isStagingHost()) {
        try {
            if (!localStorage.getItem(STAGING_GLOW_DEFAULT_FLAG)) {
                settings.lookFeel.glowIntensity = 50;
                localStorage.setItem(STAGING_GLOW_DEFAULT_FLAG, '1');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            }
        } catch (e) { /* ignore quota / private mode */ }
    }

    // Sanitize any corrupted soundPack names from old saves
    if (settings.soundscape && settings.soundscape.soundPack) {
        settings.soundscape.soundPack = String(settings.soundscape.soundPack).replace(/\s+/g, ' ').trim();
    }

    // Migrate old boolean errorSounds to new string options ('beep', 'mute', 'off')
    if (settings.soundscape && typeof settings.soundscape.errorSounds === 'boolean') {
        settings.soundscape.errorSounds = settings.soundscape.errorSounds ? 'beep' : 'mute';
    }

    // Sanitize removed / unknown languages
    if (settings.languageContent && settings.languageContent.testLanguage) {
        const langId = settings.languageContent.testLanguage;
        let valid = false;
        if (typeof ALL_LANGUAGES !== 'undefined' && Array.isArray(ALL_LANGUAGES)) {
            valid = ALL_LANGUAGES.some(l => l.file === langId);
        }
        if (!valid && typeof getSettingsPageLanguages === 'function') {
            try {
                valid = getSettingsPageLanguages().some(l => l.file === langId);
            } catch (e) { /* ignore */ }
        }
        if (!valid && typeof window.resolveLanguageKeymapLayout === 'function') {
            // Keep languages we have a keymap for even if the wordlist list is stale
            const layout = window.resolveLanguageKeymapLayout(langId);
            valid = layout && layout !== 'QWERTY' ? true : valid;
            if (langId === 'english' || String(langId).startsWith('english')
                || String(langId).startsWith('dutch')
                || String(langId).startsWith('indonesian')
                || String(langId).startsWith('japanese_romaji')
                || String(langId).startsWith('code_')) {
                valid = true;
            }
        }
        if (!valid) {
            settings.languageContent.testLanguage = 'english';
        }
    }

    if (settings.cursor) {
        // Collapse legacy dual/rooms tape settings into the shared tapeMode.
        if (
            (settings.cursor.tapeMode === undefined || settings.cursor.tapeMode === null)
            && (settings.cursor.tapeModeInDual || settings.cursor.tapeModeInRooms)
        ) {
            settings.cursor.tapeMode = settings.cursor.tapeModeInDual
                || settings.cursor.tapeModeInRooms
                || 'off';
        }
        delete settings.cursor.tapeModeInDual;
        delete settings.cursor.tapeModeInRooms;
    }

    if (settings.resultsAndGraphs && settings.resultsAndGraphs.minBurst !== undefined) {
        delete settings.resultsAndGraphs.minBurst;
    }

    // Migrate quickRestart from testRules to keyboardLayout
    if (settings.testRules && settings.testRules.quickRestart !== undefined) {
        if (!settings.keyboardLayout) settings.keyboardLayout = {};
        settings.keyboardLayout.quickRestart = settings.testRules.quickRestart;
        if (settings.testRules.quickRestartCustomKey !== undefined) {
            settings.keyboardLayout.quickRestartCustomKey = settings.testRules.quickRestartCustomKey;
        }
        delete settings.testRules.quickRestart;
        delete settings.testRules.quickRestartCustomKey;
    }

    // Migrate quickRestart string options (Off/Tab/Custom) → boolean toggle
    if (settings.keyboardLayout && typeof settings.keyboardLayout.quickRestart === 'string') {
        settings.keyboardLayout.quickRestart = settings.keyboardLayout.quickRestart === 'Tab';
    }
    if (settings.keyboardLayout && settings.keyboardLayout.keyboardShortcuts === undefined) {
        settings.keyboardLayout.keyboardShortcuts = true;
    }

    // One-time: adopt language-appropriate keymap for existing saves
    if (settings.keyboardLayout && settings.keyboardLayout.keymapLangSyncVersion !== 1) {
        if (typeof window.syncKeymapLayoutForLanguage === 'function') {
            window.syncKeymapLayoutForLanguage(settings);
        }
        settings.keyboardLayout.keymapLangSyncVersion = 1;
    }

    // Look & Feel migrations
    if (settings.lookFeel) {
        if (settings.lookFeel.randomizeTheme === 'Favorites') {
            settings.lookFeel.randomizeTheme = 'All';
        }
        if (!settings.lookFeel.customTheme || typeof settings.lookFeel.customTheme !== 'object') {
            settings.lookFeel.customTheme = structuredClone(CUSTOM_THEME_DEFAULT);
        } else {
            settings.lookFeel.customTheme = {
                mode: isLightModeValue(settings.lookFeel.customTheme.mode) ? 'Light' : 'Dark',
                mainColor: normalizeHexColor(
                    settings.lookFeel.customTheme.mainColor,
                    CUSTOM_THEME_DEFAULT.mainColor
                ),
                secondaryColor: normalizeHexColor(
                    settings.lookFeel.customTheme.secondaryColor,
                    CUSTOM_THEME_DEFAULT.secondaryColor
                ),
                bgColor: normalizeHexColor(
                    settings.lookFeel.customTheme.bgColor
                    || (isLightModeValue(settings.lookFeel.customTheme.mode) ? '#ffffff' : '#000000'),
                    CUSTOM_THEME_DEFAULT.bgColor
                ),
                bgSpectrumPos: normalizeSpectrumPos(
                    settings.lookFeel.customTheme.bgSpectrumPos,
                    null
                ),
            };
            if (settings.lookFeel.customTheme.bgSpectrumPos == null) {
                settings.lookFeel.customTheme.bgSpectrumPos = spectrumPosFromBgColor(
                    settings.lookFeel.customTheme.mode,
                    settings.lookFeel.customTheme.bgColor
                );
            }
        }
        if (!Array.isArray(settings.lookFeel.customPresets)) {
            settings.lookFeel.customPresets = [];
        } else {
            settings.lookFeel.customPresets = settings.lookFeel.customPresets
                .slice(0, MAX_CUSTOM_PRESETS)
                .map((p, i) => {
                    const mode = isLightModeValue(p?.mode) ? 'Light' : 'Dark';
                    const bgColor = normalizeHexColor(
                        p?.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
                        CUSTOM_THEME_DEFAULT.bgColor
                    );
                    return {
                        name: (p && p.name) || `Custom ${i + 1}`,
                        mode,
                        mainColor: normalizeHexColor(p?.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
                        secondaryColor: normalizeHexColor(p?.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
                        bgColor,
                        bgSpectrumPos: resolveSpectrumPos(mode, bgColor, p?.bgSpectrumPos),
                    };
                });
        }
        if (!settings.lookFeel.randomizeTheme) {
            settings.lookFeel.randomizeTheme = 'Off';
        }
        settings.lookFeel.glowIntensity = normalizeGlowIntensity(settings.lookFeel.glowIntensity);
    }

    window.usertypo_settings = settings;
    return settings;
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.usertypo_settings = settings;
}

function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (
            source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
            target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
        ) {
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

function setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]]) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

function getByPath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
}


// ─────────────────────────────────────────────────────────────────────────────
//  1b. THEME PALETTES & APPLICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete color palettes for every theme.
 * Keys match the button text in the Color Theme opt-btn grid.
 *
 * Each palette provides:
 *   bgMain        – Body / main canvas background
 *   bgSecondary   – Menus, modals, settings panels, surfaces
 *   textPrimary   – Correct letters, headings, active items
 *   textMuted     – Untyped letters, secondary text, icons
 *   accentPrimary – Caret, primary buttons, active toggles
 *   accentHover   – Hover variation of accent
 *   error         – Error / mistake color
 */
const THEME_PALETTES = {
    'usertypo_': {
        bgMain: '#020016',
        bgSecondary: '#1a1d23',
        textPrimary: '#e2e8f0',
        textMuted: '#64748b',
        accentPrimary: '#00d0ff',
        accentHover: '#33d9ff',
        error: '#ff3333',
    },
    'Minecraft': {
        bgMain: '#3b3328',
        bgSecondary: '#55493b',
        textPrimary: '#55ff55',
        textMuted: '#8b8b6a',
        accentPrimary: '#55d4d8',
        accentHover: '#7eebed',
        error: '#ff3333',
    },
    'Spider-Man': {
        bgMain: '#0b0c10',
        bgSecondary: '#454e59',
        textPrimary: '#e23636',
        textMuted: '#8892a0',
        accentPrimary: '#2b76c8',
        accentHover: '#4a90d9',
        error: '#ff3333',
    },
    'Batman': {
        bgMain: '#0a0a0a',
        bgSecondary: '#404040',
        textPrimary: '#c4c4c4',
        textMuted: '#737373',
        accentPrimary: '#f1c40f',
        accentHover: '#f4d03f',
        error: '#e74c3c',
    },
    'Iron Man': {
        bgMain: '#4a0e0e',
        bgSecondary: '#8a3131',
        textPrimary: '#ffffff',
        textMuted: '#c47a7a',
        accentPrimary: '#fadb5f',
        accentHover: '#fce588',
        error: '#ff3333',
    },
    'The Joker': {
        bgMain: '#1a0f2e',
        bgSecondary: '#4c3b73',
        textPrimary: '#d4c1f9',
        textMuted: '#8a74b8',
        accentPrimary: '#2ecc71',
        accentHover: '#58d68d',
        error: '#e74c3c',
    },
    'Superman': {
        bgMain: '#051b3b',
        bgSecondary: '#35527a',
        textPrimary: '#f7f7f7',
        textMuted: '#8aa3c8',
        accentPrimary: '#e23636',
        accentHover: '#e85c5c',
        error: '#ff3333',
    },
    'Wolverine': {
        bgMain: '#1a1a1a',
        bgSecondary: '#595959',
        textPrimary: '#f2ca00',
        textMuted: '#999966',
        accentPrimary: '#004b87',
        accentHover: '#0066b3',
        error: '#cc0000',
    },
    'Cyberpunk': {
        bgMain: '#0f0f12',
        bgSecondary: '#535a6b',
        textPrimary: '#e60067',
        textMuted: '#8b8fa3',
        accentPrimary: '#00ffcc',
        accentHover: '#33ffd6',
        error: '#ff3333',
    },
    'Matrix': {
        bgMain: '#000000',
        bgSecondary: '#003b00',
        textPrimary: '#00ff41',
        textMuted: '#267a3a',
        accentPrimary: '#ffffff',
        accentHover: '#ccffcc',
        error: '#ff003c',
    },
    'Synthwave': {
        bgMain: '#2b213a',
        bgSecondary: '#604d7c',
        textPrimary: '#ff9e64',
        textMuted: '#9a86b8',
        accentPrimary: '#f7768e',
        accentHover: '#f99aab',
        error: '#ff3333',
    },
    'Space Cadet': {
        bgMain: '#171a21',
        bgSecondary: '#4f5b66',
        textPrimary: '#a7adba',
        textMuted: '#6d7a88',
        accentPrimary: '#8bd49c',
        accentHover: '#a8e0b5',
        error: '#ec5f67',
    },
    'Matcha': {
        bgMain: '#f4f4f0',
        bgSecondary: '#c2c7b4',
        textPrimary: '#4d5c44',
        textMuted: '#8a9480',
        accentPrimary: '#798c6c',
        accentHover: '#92a585',
        error: '#d97373',
    },
    'Lavender': {
        bgMain: '#f5f3fa',
        bgSecondary: '#c8c0db',
        textPrimary: '#5f4b8b',
        textMuted: '#9486b0',
        accentPrimary: '#9b86cc',
        accentHover: '#b3a1d9',
        error: '#e07a5f',
    },
    'Oceanic': {
        bgMain: '#102a43',
        bgSecondary: '#334e68',
        textPrimary: '#82c0cc',
        textMuted: '#5a8a96',
        accentPrimary: '#486581',
        accentHover: '#627d99',
        error: '#ff6b6b',
    },
    'Campfire': {
        bgMain: '#2c2826',
        bgSecondary: '#695d56',
        textPrimary: '#fca311',
        textMuted: '#a09080',
        accentPrimary: '#e5e5e5',
        accentHover: '#ffffff',
        error: '#d90429',
    },
    'Cherry Blossom': {
        bgMain: '#2e1a24',
        bgSecondary: '#7a5061',
        textPrimary: '#ffb8d1',
        textMuted: '#b0859a',
        accentPrimary: '#ff5c93',
        accentHover: '#ff85ad',
        error: '#e52b50',
    },
    'Abyss': {
        bgMain: '#000000',
        bgSecondary: '#444444',
        textPrimary: '#cccccc',
        textMuted: '#777777',
        accentPrimary: '#ffffff',
        accentHover: '#dddddd',
        error: '#ff4444',
    },
    'Paper': {
        bgMain: '#f2f4f7',
        bgSecondary: '#a8b0bc',
        textPrimary: '#2a3038',
        textMuted: '#64748b',
        accentPrimary: '#1e293b',
        accentHover: '#334155',
        error: '#dc2626',
    },
    'Dracula': {
        bgMain: '#282a36',
        bgSecondary: '#6272a4',
        textPrimary: '#f8f8f2',
        textMuted: '#8892a8',
        accentPrimary: '#bd93f9',
        accentHover: '#caa8fc',
        error: '#ff5555',
    },
};

window.usertypo_THEME_PALETTES = THEME_PALETTES;

function normalizeHexColor(value, fallback = '#ffffff') {
    if (typeof value !== 'string') return fallback;
    let hex = value.trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
        hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
    return hex.toLowerCase();
}

function getHexLuminance(hex) {
    const clean = normalizeHexColor(hex, '#000000').slice(1);
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isLightModeValue(mode) {
    return String(mode || '').toLowerCase() === 'light';
}

function getCustomThemeConfig(settings, themeName) {
    const lf = settings?.lookFeel || {};
    const name = themeName || lf.colorTheme || 'custom';
    if (typeof name === 'string' && name.startsWith('custom:')) {
        const idx = parseInt(name.slice(7), 10);
        const preset = Array.isArray(lf.customPresets) ? lf.customPresets[idx] : null;
        if (preset) {
            const mode = isLightModeValue(preset.mode) ? 'Light' : 'Dark';
            const bgColor = normalizeHexColor(
                preset.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
                CUSTOM_THEME_DEFAULT.bgColor
            );
            return {
                mode,
                mainColor: normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
                secondaryColor: normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
                bgColor,
                bgSpectrumPos: resolveSpectrumPos(mode, bgColor, preset.bgSpectrumPos),
                name: preset.name || `Custom ${idx + 1}`,
                presetIndex: idx,
            };
        }
    }
    const live = lf.customTheme || CUSTOM_THEME_DEFAULT;
    const mode = isLightModeValue(live.mode) ? 'Light' : 'Dark';
    const bgColor = normalizeHexColor(
        live.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
        CUSTOM_THEME_DEFAULT.bgColor
    );
    return {
        mode,
        mainColor: normalizeHexColor(live.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
        secondaryColor: normalizeHexColor(live.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
        bgColor,
        bgSpectrumPos: resolveSpectrumPos(mode, bgColor, live.bgSpectrumPos),
        name: 'Custom',
        presetIndex: null,
    };
}

function hslToHex(h, s, l) {
    const sat = Math.max(0, Math.min(100, s)) / 100;
    const lit = Math.max(0, Math.min(100, l)) / 100;
    const a = sat * Math.min(lit, 1 - lit);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const color = lit - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex) {
    const clean = normalizeHexColor(hex, '#000000').slice(1);
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h: h * 360, s, l };
}

/** CSS gradient for light pastel or dark deep hue spectrum. */
function getBgSpectrumGradient(mode) {
    const light = isLightModeValue(mode);
    const stops = [];
    for (let i = 0; i <= 12; i++) {
        const h = (i / 12) * 360;
        stops.push(hslToHex(h, light ? 48 : 58, light ? 91 : 11));
    }
    if (light) {
        return `linear-gradient(90deg, #ffffff 0%, ${stops.join(', ')}, #f3f3f3 100%)`;
    }
    return `linear-gradient(90deg, #000000 0%, ${stops.join(', ')}, #1c1c1c 100%)`;
}

function bgColorFromSpectrum(mode, t) {
    const pos = Math.max(0, Math.min(1, Number(t) || 0));
    const light = isLightModeValue(mode);
    if (light) {
        if (pos <= 0.05) return '#ffffff';
        if (pos >= 0.95) return '#f0f0f0';
        const h = ((pos - 0.05) / 0.9) * 360;
        return hslToHex(h, 46, 91);
    }
    if (pos <= 0.05) return '#000000';
    if (pos >= 0.95) return '#1a1a1a';
    const h = ((pos - 0.05) / 0.9) * 360;
    return hslToHex(h, 55, 11);
}

function normalizeSpectrumPos(value, fallback = null) {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

function resolveSpectrumPos(mode, bgColor, storedPos) {
    const fromStore = normalizeSpectrumPos(storedPos, null);
    if (fromStore != null) return fromStore;
    return spectrumPosFromBgColor(mode, bgColor);
}

function spectrumPosFromBgColor(mode, hex) {
    const { h, s, l } = hexToHsl(hex);
    const light = isLightModeValue(mode);
    if (light) {
        if (l > 0.97 && s < 0.08) return 0;
        if (l > 0.9 && s < 0.08) return 1;
        return 0.05 + (h / 360) * 0.9;
    }
    if (l < 0.03) return 0;
    if (l < 0.12 && s < 0.08) return 1;
    return 0.05 + (h / 360) * 0.9;
}

/**
 * Visual left for the spectrum thumb center.
 * Geometry: pad 0.5rem + thumb 1.15rem inside the 2.15rem-tall pill
 * (even padding on every side). Value 0..1 still maps the full color range.
 */
function spectrumThumbLeftCss(t) {
    const pos = Math.max(0, Math.min(1, Number(t) || 0));
    // center = pad + halfThumb + t * (100% - 2*pad - thumb)
    //        = 1.075rem + t * (100% - 2.15rem)
    return `calc(1.075rem + ${pos} * (100% - 2.15rem))`;
}

function setBgSpectrumThumb(thumb, t, hex) {
    if (!thumb) return;
    thumb.style.left = spectrumThumbLeftCss(t);
    if (hex) thumb.style.background = hex;
}

/** Map pointer X to 0..1 along the same inset track the visible thumb uses. */
function spectrumTFromClientX(wrap, clientX) {
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return 0;
    const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const pad = 0.5 * rootFs;
    const thumb = 1.15 * rootFs;
    const half = thumb / 2;
    const x0 = rect.left + pad + half;
    const x1 = rect.right - pad - half;
    if (x1 <= x0) return 0;
    return Math.max(0, Math.min(1, (clientX - x0) / (x1 - x0)));
}

/** Apply a spectrum position to the active custom-theme editor. */
function applyBgSpectrumPosition(editor, t) {
    if (!editor) return;
    const modeBtn = editor.querySelector('[data-custom-theme-mode] .opt-btn.active');
    const mode = modeBtn ? resolveOptValue(modeBtn) : 'Dark';
    const pos = Math.max(0, Math.min(1, Number(t) || 0));
    const hex = bgColorFromSpectrum(mode, pos);
    const slider = editor.querySelector('[data-custom-bg-spectrum]');
    if (slider) slider.value = String(Math.round(pos * 100));
    setBgSpectrumThumb(editor.querySelector('[data-bg-spectrum-thumb]'), pos, hex);
    const face = editor.querySelector('[data-swatch-face="bgColor"]');
    const hexInput = editor.querySelector('[data-custom-hex="bgColor"]');
    if (face) face.style.background = hex;
    if (hexInput) hexInput.value = hex;
    // Persist explicit spectrum position so sync cannot remap ambiguous edge
    // colors (e.g. dark red near t=0.95 → remapped 0.05) back onto the thumb.
    commitCustomTheme({
        ...readCustomThemeFromEditor(editor),
        bgColor: hex,
        bgSpectrumPos: pos,
    });
}

/**
 * Build a full theme palette from mode + colors.
 * bgColor → page background
 * mainColor → accent + logo "typ_"
 * secondaryColor → primary text + logo "user"
 */
function buildCustomPalette(config) {
    const cfg = config || CUSTOM_THEME_DEFAULT;
    const light = isLightModeValue(cfg.mode);
    const main = normalizeHexColor(cfg.mainColor, light ? '#000000' : '#ffffff');
    const secondary = normalizeHexColor(cfg.secondaryColor, light ? '#333333' : '#cccccc');
    const bg = normalizeHexColor(
        cfg.bgColor || (light ? '#ffffff' : '#000000'),
        light ? '#ffffff' : '#000000'
    );

    return {
        bgMain: bg,
        bgSecondary: light ? _darkenColor(bg, 10) : _shadeColor(bg, 14),
        textPrimary: secondary,
        textMuted: light ? '#888888' : '#777777',
        accentPrimary: main,
        accentHover: light ? _darkenColor(main, 12) : _shadeColor(main, 18),
        error: light ? '#cc0000' : '#ff4444',
    };
}

function getModeDefaults(mode) {
    const light = isLightModeValue(mode);
    if (light) {
        const base = THEME_PALETTES['Paper'];
        return {
            mode: 'Light',
            mainColor: normalizeHexColor(base?.accentPrimary, '#000000'),
            secondaryColor: normalizeHexColor(base?.textPrimary, '#333333'),
            bgColor: normalizeHexColor(base?.bgMain, '#ffffff'),
            bgSpectrumPos: 0,
        };
    }
    const base = THEME_PALETTES['Abyss'];
    return {
        mode: 'Dark',
        mainColor: normalizeHexColor(base?.accentPrimary, '#ffffff'),
        secondaryColor: normalizeHexColor(base?.textPrimary, '#cccccc'),
        bgColor: normalizeHexColor(base?.bgMain, '#000000'),
        bgSpectrumPos: 0,
    };
}

function isCustomThemeName(themeName) {
    return themeName === 'custom' || (typeof themeName === 'string' && themeName.startsWith('custom:'));
}

function resolveThemePalette(settings, themeName) {
    if (!settings) settings = loadSettings();
    const name = themeName || settings.lookFeel?.colorTheme || getPreferredDefaultTheme();
    if (isCustomThemeName(name)) {
        return buildCustomPalette(getCustomThemeConfig(settings, name));
    }
    return THEME_PALETTES[name] || THEME_PALETTES[getPreferredDefaultTheme()] || THEME_PALETTES['Abyss'];
}

function getThemeDisplayName(themeName, settings) {
    if (!settings) settings = loadSettings();
    if (isCustomThemeName(themeName || settings.lookFeel?.colorTheme)) return 'custom';
    return themeName || settings.lookFeel?.colorTheme || getPreferredDefaultTheme();
}

function isThemeLight(themeName, settings) {
    if (!settings) settings = loadSettings();
    if (isCustomThemeName(themeName)) {
        return isLightModeValue(getCustomThemeConfig(settings, themeName).mode);
    }
    const p = THEME_PALETTES[themeName];
    if (!p?.bgMain) return false;
    return getHexLuminance(p.bgMain) > 0.55;
}

function getRandomizeThemePool(mode, settings) {
    if (!settings) settings = loadSettings();
    const builtIn = Object.keys(THEME_PALETTES);
    const presets = Array.isArray(settings.lookFeel?.customPresets)
        ? settings.lookFeel.customPresets.map((_, i) => `custom:${i}`)
        : [];
    let pool = [...builtIn, ...presets];
    const filter = String(mode || 'Off');
    if (filter === 'Light') pool = pool.filter((n) => isThemeLight(n, settings));
    else if (filter === 'Dark') pool = pool.filter((n) => !isThemeLight(n, settings));
    else if (filter !== 'All') return [];
    return pool;
}

function maybeRandomizeTheme() {
    const settings = loadSettings();
    const mode = settings.lookFeel?.randomizeTheme || 'Off';
    if (!mode || mode === 'Off') return null;
    const pool = getRandomizeThemePool(mode, settings);
    if (!pool.length) return null;
    const current = settings.lookFeel?.colorTheme;
    const candidates = pool.length > 1 ? pool.filter((n) => n !== current) : pool;
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    selectColorTheme(next);
    return next;
}

/** Prefer the cloned editor in the open detail panel over the hidden source copy. */
function getActiveCustomThemeEditor() {
    const detail = document.querySelector(
        '#settings-panel .settings-panel-card.is-detail [data-custom-theme-editor]'
    );
    if (detail) return detail;
    const inPanel = document.querySelector(
        '#settings-panel .settings-panel-card:not(#panel-card) [data-custom-theme-editor]'
    );
    if (inPanel) return inPanel;
    return document.querySelector('[data-custom-theme-editor]');
}

function forEachCustomThemeEditor(callback) {
    document.querySelectorAll('[data-custom-theme-editor]').forEach(callback);
}

/** True while programmatically syncing editor DOM — blocks commit from synthetic input events. */
let __customThemeSyncLock = 0;
/** Smoothly animate theme color changes for ~500ms (user switches only — never first paint). */
let __lastAppliedThemeKey = null;

function beginCustomThemeSync() {
    __customThemeSyncLock += 1;
}

function endCustomThemeSync() {
    __customThemeSyncLock = Math.max(0, __customThemeSyncLock - 1);
}

function isCustomThemeSyncLocked() {
    return __customThemeSyncLock > 0;
}

function syncOneCustomThemeEditor(editor, settings, cfg) {
    if (!editor) return;
    const modeBox = editor.querySelector('[data-custom-theme-mode]');
    if (modeBox) {
        modeBox.querySelectorAll('.opt-btn').forEach((btn) => {
            btn.classList.toggle('active', resolveOptValue(btn) === cfg.mode);
        });
    }

    ['mainColor', 'secondaryColor', 'bgColor'].forEach((key) => {
        const hex = cfg[key];
        const colorInput = editor.querySelector(`[data-custom-color="${key}"]`);
        const hexInput = editor.querySelector(`[data-custom-hex="${key}"]`);
        const face = editor.querySelector(`[data-swatch-face="${key}"]`);
        if (colorInput) colorInput.value = hex;
        if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;
        if (face) face.style.background = hex;
    });

    const spectrum = editor.querySelector('[data-bg-spectrum]');
    if (spectrum) {
        spectrum.dataset.mode = cfg.mode.toLowerCase();
        const track = spectrum.querySelector('[data-bg-spectrum-track]');
        if (track) track.style.background = getBgSpectrumGradient(cfg.mode);
        const slider = spectrum.querySelector('[data-custom-bg-spectrum]');
        const pos = resolveSpectrumPos(cfg.mode, cfg.bgColor, cfg.bgSpectrumPos);
        // Always write the slider during sync so a focused clone/source copy
        // cannot keep a stale value that later commits over a just-applied preset.
        if (slider) {
            slider.value = String(Math.round(pos * 100));
        }
        const thumb = spectrum.querySelector('[data-bg-spectrum-thumb]');
        if (thumb) {
            setBgSpectrumThumb(thumb, pos, cfg.bgColor);
        }
    }

    const preview = editor.querySelector('[data-custom-theme-preview]');
    if (preview) {
        const palette = buildCustomPalette(cfg);
        const bg = preview.querySelector('[data-preview="bg"]');
        const main = preview.querySelector('[data-preview="main"]');
        const secondary = preview.querySelector('[data-preview="secondary"]');
        if (bg) bg.style.background = palette.bgMain;
        if (main) main.style.background = palette.accentPrimary;
        if (secondary) secondary.style.background = palette.textPrimary;
    }

    renderCustomThemePresetsInto(editor, settings);
}

function syncCustomThemeEditor(settings) {
    if (!settings) settings = loadSettings();
    // Sync from the active theme (custom / custom:N), not always the live draft.
    const cfg = getCustomThemeConfig(settings, settings.lookFeel?.colorTheme || 'custom');
    beginCustomThemeSync();
    try {
        forEachCustomThemeEditor((editor) => syncOneCustomThemeEditor(editor, settings, cfg));
    } finally {
        endCustomThemeSync();
    }
}

function renderCustomThemePresets(settings) {
    if (!settings) settings = loadSettings();
    forEachCustomThemeEditor((editor) => renderCustomThemePresetsInto(editor, settings));
}

function renderCustomThemePresetsInto(editor, settings) {
    if (!editor) return;
    const list = editor.querySelector('[data-custom-theme-preset-list]');
    const countEl = editor.querySelector('[data-custom-preset-count]');
    const saveBtn = editor.querySelector('[data-custom-theme-save]');
    if (!list) return;
    if (!settings) settings = loadSettings();

    const presets = Array.isArray(settings.lookFeel?.customPresets)
        ? settings.lookFeel.customPresets
        : [];
    if (countEl) countEl.textContent = String(presets.length);
    if (saveBtn) saveBtn.disabled = presets.length >= MAX_CUSTOM_PRESETS;

    const active = settings.lookFeel?.colorTheme || '';
    if (!presets.length) {
        list.innerHTML = `<p class="custom-preset-empty">No saved presets yet. Build a theme above, then save it here.</p>`;
        return;
    }

    list.innerHTML = presets.map((preset, index) => {
        const main = normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor);
        const secondary = normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor);
        const bg = normalizeHexColor(
            preset.bgColor || (isLightModeValue(preset.mode) ? '#ffffff' : '#000000'),
            CUSTOM_THEME_DEFAULT.bgColor
        );
        const mode = isLightModeValue(preset.mode) ? 'Light' : 'Dark';
        const name = preset.name || `Custom ${index + 1}`;
        const themeId = `custom:${index}`;
        const activeClass = active === themeId ? ' is-active' : '';
        return `
            <div class="custom-preset-card${activeClass}" data-preset-index="${index}">
                <div class="custom-preset-swatches" aria-hidden="true">
                    <i style="background:${bg}"></i>
                    <i style="background:${main}"></i>
                    <i style="background:${secondary}"></i>
                </div>
                <div class="custom-preset-meta">
                    <div class="name">${name}</div>
                    <div class="sub">${mode} · ${main}</div>
                </div>
                <div class="custom-preset-actions">
                    <button type="button" class="custom-preset-icon-btn" data-preset-apply="${index}" title="Apply preset">
                        <span class="material-symbols-outlined">play_arrow</span>
                    </button>
                    <button type="button" class="custom-preset-icon-btn is-danger" data-preset-delete="${index}" title="Delete preset">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function readCustomThemeFromEditor(editor) {
    const root = editor || getActiveCustomThemeEditor();
    const settings = loadSettings();
    const fallback = getCustomThemeConfig(settings, 'custom');
    if (!root) {
        return {
            mode: fallback.mode,
            mainColor: fallback.mainColor,
            secondaryColor: fallback.secondaryColor,
            bgColor: fallback.bgColor,
            bgSpectrumPos: fallback.bgSpectrumPos,
        };
    }
    const modeBtn = root.querySelector('[data-custom-theme-mode] .opt-btn.active');
    const mode = modeBtn ? resolveOptValue(modeBtn) : fallback.mode;
    const mainColor = normalizeHexColor(
        root.querySelector('[data-custom-hex="mainColor"]')?.value
        || root.querySelector('[data-custom-color="mainColor"]')?.value
        || fallback.mainColor,
        fallback.mainColor
    );
    const secondaryColor = normalizeHexColor(
        root.querySelector('[data-custom-hex="secondaryColor"]')?.value
        || root.querySelector('[data-custom-color="secondaryColor"]')?.value
        || fallback.secondaryColor,
        fallback.secondaryColor
    );
    const bgColor = normalizeHexColor(
        root.querySelector('[data-custom-hex="bgColor"]')?.value
        || root.querySelector('[data-custom-color="bgColor"]')?.value
        || fallback.bgColor,
        fallback.bgColor
    );
    const slider = root.querySelector('[data-custom-bg-spectrum]');
    const bgSpectrumPos = slider
        ? normalizeSpectrumPos(Number(slider.value) / 100, fallback.bgSpectrumPos)
        : fallback.bgSpectrumPos;
    return {
        mode: isLightModeValue(mode) ? 'Light' : 'Dark',
        mainColor,
        secondaryColor,
        bgColor,
        bgSpectrumPos,
    };
}

/** Persist custom theme config and apply it site-wide immediately. */
function commitCustomTheme(partial, options = {}) {
    // Ignore synthetic input/change events fired while we programmatically sync
    // cloned + source Custom Theme editors (SPA panel copies). Those events used
    // to overwrite a just-applied preset and make play appear to do nothing.
    if (isCustomThemeSyncLocked() && !options.force) return null;

    const settings = loadSettings();
    if (!settings.lookFeel) settings.lookFeel = structuredClone(DEFAULTS.lookFeel);

    const current = settings.lookFeel.customTheme || structuredClone(CUSTOM_THEME_DEFAULT);
    let next = {
        mode: isLightModeValue(partial?.mode ?? current.mode) ? 'Light' : 'Dark',
        mainColor: normalizeHexColor(partial?.mainColor ?? current.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
        secondaryColor: normalizeHexColor(
            partial?.secondaryColor ?? current.secondaryColor,
            CUSTOM_THEME_DEFAULT.secondaryColor
        ),
        bgColor: normalizeHexColor(
            partial?.bgColor ?? current.bgColor ?? CUSTOM_THEME_DEFAULT.bgColor,
            CUSTOM_THEME_DEFAULT.bgColor
        ),
    };

    // Switching Light/Dark reseeds from Paper / Abyss defaults
    if (options.seedFromMode) {
        next = getModeDefaults(next.mode);
    } else if (partial && Object.prototype.hasOwnProperty.call(partial, 'bgSpectrumPos')) {
        next.bgSpectrumPos = normalizeSpectrumPos(partial.bgSpectrumPos, 0);
    } else if (
        partial
        && partial.bgColor != null
        && normalizeHexColor(partial.bgColor, '') !== normalizeHexColor(current.bgColor, '')
    ) {
        // Hex/swatch edit without an explicit slider pos — derive from color.
        next.bgSpectrumPos = spectrumPosFromBgColor(next.mode, next.bgColor);
    } else {
        next.bgSpectrumPos = resolveSpectrumPos(next.mode, next.bgColor, current.bgSpectrumPos);
    }

    settings.lookFeel.customTheme = next;
    settings.lookFeel.colorTheme = 'custom';
    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
    if (typeof window.triggerSave === 'function') window.triggerSave();
    return next;
}

function applyCustomThemeFromEditor() {
    return commitCustomTheme(readCustomThemeFromEditor(), { force: true });
}

function saveCustomThemePreset() {
    const settings = loadSettings();
    if (!settings.lookFeel) settings.lookFeel = structuredClone(DEFAULTS.lookFeel);
    if (!Array.isArray(settings.lookFeel.customPresets)) settings.lookFeel.customPresets = [];
    if (settings.lookFeel.customPresets.length >= MAX_CUSTOM_PRESETS) return false;

    const cfg = readCustomThemeFromEditor();
    settings.lookFeel.customTheme = cfg;
    const index = settings.lookFeel.customPresets.length;
    settings.lookFeel.customPresets.push({
        name: `Custom ${index + 1}`,
        mode: cfg.mode,
        mainColor: cfg.mainColor,
        secondaryColor: cfg.secondaryColor,
        bgColor: cfg.bgColor,
        bgSpectrumPos: normalizeSpectrumPos(cfg.bgSpectrumPos, spectrumPosFromBgColor(cfg.mode, cfg.bgColor)),
    });
    settings.lookFeel.colorTheme = `custom:${index}`;
    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
    if (typeof window.triggerSave === 'function') window.triggerSave();
    return true;
}

function applyCustomThemePreset(index) {
    const idx = Number.parseInt(index, 10);
    if (!Number.isFinite(idx) || idx < 0) return false;

    const settings = loadSettings();
    const presets = settings.lookFeel?.customPresets;
    if (!Array.isArray(presets) || !presets[idx]) return false;
    const preset = presets[idx];
    const mode = isLightModeValue(preset.mode) ? 'Light' : 'Dark';
    const bgColor = normalizeHexColor(
        preset.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
        CUSTOM_THEME_DEFAULT.bgColor
    );
    settings.lookFeel.customTheme = {
        mode,
        mainColor: normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
        secondaryColor: normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
        bgColor,
        bgSpectrumPos: resolveSpectrumPos(mode, bgColor, preset.bgSpectrumPos),
    };
    settings.lookFeel.colorTheme = `custom:${idx}`;
    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
    // Re-apply after sync so any suppressed editor noise cannot leave the site
    // on the previous palette. Sync lock prevents commits during the sync above.
    applyThemeSettings(settings);
    if (typeof window.triggerSave === 'function') window.triggerSave();
    return true;
}

function deleteCustomThemePreset(index) {
    const settings = loadSettings();
    const presets = settings.lookFeel?.customPresets;
    if (!Array.isArray(presets) || !presets[index]) return;

    const current = settings.lookFeel.colorTheme;
    presets.splice(index, 1);

    if (current === `custom:${index}`) {
        settings.lookFeel.colorTheme = 'custom';
    } else if (typeof current === 'string' && current.startsWith('custom:')) {
        const curIdx = parseInt(current.slice(7), 10);
        if (!Number.isNaN(curIdx) && curIdx > index) {
            settings.lookFeel.colorTheme = `custom:${curIdx - 1}`;
        }
    }

    settings.lookFeel.customPresets = presets.map((p, i) => ({
        ...p,
        name: p.name && !/^Custom \d+$/.test(p.name) ? p.name : `Custom ${i + 1}`,
    }));

    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
    if (typeof window.triggerSave === 'function') window.triggerSave();
}

function syncColorThemeSelectLabel(settings) {
    if (!settings) settings = loadSettings();
    const themeName = settings.lookFeel?.colorTheme || getPreferredDefaultTheme();
    const label = getThemeDisplayName(themeName, settings);

    document.querySelectorAll('[data-setting="lookFeel.colorTheme"]').forEach((container) => {
        if (isCustomThemeName(themeName)) {
            container.querySelectorAll('.opt-btn').forEach((btn) => btn.classList.remove('active'));
        } else {
            const savedNorm = String(themeName).replace(/\s+/g, ' ').trim();
            container.querySelectorAll('.opt-btn').forEach((btn) => {
                btn.classList.toggle('active', resolveOptValue(btn) === savedNorm);
            });
        }

        const card = container.closest('.sub-setting-card') || container.closest('[data-sub-title]');
        const selectLabel = card?.querySelector('.setting-select .truncate');
        if (selectLabel) selectLabel.textContent = label;
    });
}

// ── Custom HSV color picker (main / secondary swatches) ──────────────────────

function hexToHsv(hex) {
    const clean = normalizeHexColor(hex, '#ffffff').slice(1);
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return {
        h: h * 360,
        s: max === 0 ? 0 : d / max,
        v: max,
    };
}

function hsvToHex(h, s, v) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(1, Number(s) || 0));
    const val = Math.max(0, Math.min(1, Number(v) || 0));
    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return `#${[r, g, b].map((n) => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

let __colorPickerState = null;

function ensureThemeColorPicker() {
    let root = document.getElementById('usertypo-color-picker');
    // Rebuild if an older picker shell (with preview/hex row) is still in the DOM
    if (root && (root.querySelector('[data-picker-meta]') || !root.dataset.pickerV)) {
        root.remove();
        root = null;
    }
    if (root) return root;
    root = document.createElement('div');
    root.id = 'usertypo-color-picker';
    root.className = 'theme-color-picker';
    root.dataset.pickerV = '2';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Color picker');
    root.innerHTML = `
        <div class="theme-color-picker-sv" data-picker-sv>
            <span class="theme-color-picker-sv-cursor" data-picker-sv-cursor></span>
        </div>
        <div class="theme-color-picker-hue" data-picker-hue>
            <span class="theme-color-picker-hue-thumb" data-picker-hue-thumb></span>
        </div>
    `;
    document.body.appendChild(root);

    const sv = root.querySelector('[data-picker-sv]');
    const hue = root.querySelector('[data-picker-hue]');

    const setFromPointer = (target, clientX, clientY, kind) => {
        if (!__colorPickerState) return;
        const rect = target.getBoundingClientRect();
        if (kind === 'hue') {
            const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
            __colorPickerState.h = t * 360;
        } else {
            __colorPickerState.s = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
            __colorPickerState.v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / Math.max(1, rect.height)));
        }
        renderThemeColorPicker(true);
    };

    const bindDrag = (el, kind) => {
        el.addEventListener('pointerdown', (e) => {
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            __colorPickerState.drag = kind;
            setFromPointer(el, e.clientX, e.clientY, kind);
        });
        el.addEventListener('pointermove', (e) => {
            if (!__colorPickerState || __colorPickerState.drag !== kind) return;
            setFromPointer(el, e.clientX, e.clientY, kind);
        });
        const end = (e) => {
            if (!__colorPickerState || __colorPickerState.drag !== kind) return;
            __colorPickerState.drag = null;
            if (e && e.pointerId != null) {
                try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            }
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
    };

    bindDrag(sv, 'sv');
    bindDrag(hue, 'hue');

    return root;
}

function renderThemeColorPicker(commit) {
    const root = ensureThemeColorPicker();
    const state = __colorPickerState;
    if (!state) return;
    const hex = hsvToHex(state.h, state.s, state.v);
    const hueHex = hsvToHex(state.h, 1, 1);

    const sv = root.querySelector('[data-picker-sv]');
    const svCursor = root.querySelector('[data-picker-sv-cursor]');
    const hueThumb = root.querySelector('[data-picker-hue-thumb]');

    if (sv) {
        sv.style.backgroundImage = [
            'linear-gradient(to top, #000000, rgba(0, 0, 0, 0))',
            'linear-gradient(to right, #ffffff, rgba(255, 255, 255, 0))',
            `linear-gradient(${hueHex}, ${hueHex})`,
        ].join(', ');
    }
    if (svCursor) {
        svCursor.style.left = `${state.s * 100}%`;
        svCursor.style.top = `${(1 - state.v) * 100}%`;
        svCursor.style.background = hex;
    }
    if (hueThumb) {
        hueThumb.style.left = `calc(0.575rem + ${(state.h / 360)} * (100% - 1.15rem))`;
        hueThumb.style.background = hueHex;
    }

    const editor = state.editor;
    if (editor) {
        const key = state.key;
        const colorInput = editor.querySelector(`[data-custom-color="${key}"]`);
        const hexField = editor.querySelector(`[data-custom-hex="${key}"]`);
        const face = editor.querySelector(`[data-swatch-face="${key}"]`);
        if (colorInput) colorInput.value = hex;
        if (hexField) hexField.value = hex;
        if (face) face.style.background = hex;
    }

    if (commit && editor && state.key) {
        commitCustomTheme({
            ...readCustomThemeFromEditor(editor),
            [state.key]: hex,
        });
    }
}

function positionThemeColorPicker(anchor) {
    const root = ensureThemeColorPicker();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const pad = 10;
    const width = root.offsetWidth || 280;
    const height = root.offsetHeight || 320;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad;
    if (left < pad) left = pad;
    if (top + height > window.innerHeight - pad) top = Math.max(pad, rect.top - height - 8);
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
}

function closeThemeColorPicker() {
    const root = document.getElementById('usertypo-color-picker');
    if (root) root.classList.remove('is-open');
    __colorPickerState = null;
}

function openThemeColorPicker(swatch) {
    const editor = swatch.closest('[data-custom-theme-editor]');
    if (!editor) return;
    const colorInput = swatch.querySelector('[data-custom-color]');
    if (!colorInput) return;
    const key = colorInput.dataset.customColor;
    if (key !== 'mainColor' && key !== 'secondaryColor') return;

    const hex = normalizeHexColor(
        colorInput.value
        || editor.querySelector(`[data-custom-hex="${key}"]`)?.value
        || '#ffffff',
        '#ffffff'
    );
    const hsv = hexToHsv(hex);
    __colorPickerState = {
        editor,
        key,
        h: hsv.h,
        s: hsv.s,
        v: hsv.v,
        drag: null,
        anchor: swatch,
    };
    const root = ensureThemeColorPicker();
    root.classList.add('is-open');
    renderThemeColorPicker(false);
    positionThemeColorPicker(swatch);
}

function initCustomThemeEditor() {
    // Document-level delegation so cloned Custom Theme panels (SPA sub-setting
    // copies via innerHTML) still receive events.
    if (!window.__usertypoCustomThemeDelegated) {
        window.__usertypoCustomThemeDelegated = true;

        const eventEl = (e) => {
            const t = e && e.target;
            if (!t) return null;
            return t.nodeType === 1 ? t : t.parentElement;
        };

        document.addEventListener('click', (e) => {
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;

            const picker = el.closest('#usertypo-color-picker');
            if (picker) return;

            const swatch = el.closest('.theme-color-swatch');
            if (swatch && swatch.querySelector('[data-custom-color="mainColor"], [data-custom-color="secondaryColor"]')) {
                e.preventDefault();
                e.stopPropagation();
                if (__colorPickerState && __colorPickerState.anchor === swatch) {
                    closeThemeColorPicker();
                } else {
                    openThemeColorPicker(swatch);
                }
                return;
            }

            if (__colorPickerState) closeThemeColorPicker();
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && __colorPickerState) {
                closeThemeColorPicker();
                return;
            }
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;
            const swatch = el.closest?.('.theme-color-swatch');
            if (!swatch || !swatch.querySelector('[data-custom-color="mainColor"], [data-custom-color="secondaryColor"]')) return;
            if (el.closest('input, textarea, button')) return;
            e.preventDefault();
            openThemeColorPicker(swatch);
        }, true);

        window.addEventListener('resize', () => {
            if (__colorPickerState?.anchor) positionThemeColorPicker(__colorPickerState.anchor);
        });
        window.addEventListener('scroll', () => {
            if (__colorPickerState?.anchor) positionThemeColorPicker(__colorPickerState.anchor);
        }, true);

        document.addEventListener('input', (e) => {
            if (isCustomThemeSyncLocked()) return;
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;

            const spectrumSlider = el.closest?.('[data-custom-bg-spectrum]');
            if (spectrumSlider && spectrumSlider.closest('[data-custom-theme-editor]')) {
                // Keyboard / a11y path — pointer dragging uses the wrap handlers below.
                applyBgSpectrumPosition(
                    spectrumSlider.closest('[data-custom-theme-editor]'),
                    Number(spectrumSlider.value) / 100
                );
                return;
            }

            const input = el.closest?.('[data-custom-color]');
            if (!input || !input.closest('[data-custom-theme-editor]')) return;
            const key = input.dataset.customColor;
            const hex = normalizeHexColor(input.value, input.value);
            const editor = input.closest('[data-custom-theme-editor]');
            const hexInput = editor.querySelector(`[data-custom-hex="${key}"]`);
            const face = editor.querySelector(`[data-swatch-face="${key}"]`);
            if (hexInput) hexInput.value = hex;
            if (face) face.style.background = hex;
            commitCustomTheme({ ...readCustomThemeFromEditor(editor), [key]: hex });
        }, true);

        // Pointer-driven spectrum: map X onto the inset thumb track so the
        // visible circle never jumps when grabbed at either end.
        let __spectrumDrag = null;
        const updateSpectrumFromPointer = (wrap, clientX) => {
            const editor = wrap.closest('[data-custom-theme-editor]');
            if (!editor || isCustomThemeSyncLocked()) return;
            applyBgSpectrumPosition(editor, spectrumTFromClientX(wrap, clientX));
        };
        document.addEventListener('pointerdown', (e) => {
            if (e.button != null && e.button !== 0) return;
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;
            const wrap = el.closest('[data-bg-spectrum]');
            if (!wrap || !wrap.closest('[data-custom-theme-editor]')) return;
            e.preventDefault();
            __spectrumDrag = wrap;
            try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            const slider = wrap.querySelector('[data-custom-bg-spectrum]');
            if (slider) {
                try { slider.focus({ preventScroll: true }); } catch (_) { try { slider.focus(); } catch (__) { /* ignore */ } }
            }
            updateSpectrumFromPointer(wrap, e.clientX);
        }, true);
        document.addEventListener('pointermove', (e) => {
            if (!__spectrumDrag) return;
            updateSpectrumFromPointer(__spectrumDrag, e.clientX);
        }, true);
        const endSpectrumDrag = (e) => {
            if (!__spectrumDrag) return;
            if (e && e.pointerId != null) {
                try { __spectrumDrag.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            }
            __spectrumDrag = null;
        };
        document.addEventListener('pointerup', endSpectrumDrag, true);
        document.addEventListener('pointercancel', endSpectrumDrag, true);

        document.addEventListener('change', (e) => {
            if (isCustomThemeSyncLocked()) return;
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;
            const input = el.closest?.('[data-custom-hex]');
            if (!input || !input.closest('[data-custom-theme-editor]')) return;
            const key = input.dataset.customHex;
            const hex = normalizeHexColor(input.value, CUSTOM_THEME_DEFAULT[key]);
            input.value = hex;
            const editor = input.closest('[data-custom-theme-editor]');
            const colorInput = editor.querySelector(`[data-custom-color="${key}"]`);
            const face = editor.querySelector(`[data-swatch-face="${key}"]`);
            if (colorInput) colorInput.value = hex;
            if (face) face.style.background = hex;
            commitCustomTheme({ ...readCustomThemeFromEditor(editor), [key]: hex });
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;
            const input = el.closest?.('[data-custom-hex]');
            if (!input || !input.closest('[data-custom-theme-editor]')) return;
            e.preventDefault();
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
        }, true);

        document.addEventListener('click', (e) => {
            const el = eventEl(e);
            if (!el || typeof el.closest !== 'function') return;

            const applyBtn = el.closest('[data-custom-theme-apply]');
            if (applyBtn) {
                e.preventDefault();
                e.stopPropagation();
                applyCustomThemeFromEditor();
                return;
            }
            const saveBtn = el.closest('[data-custom-theme-save]');
            if (saveBtn) {
                e.preventDefault();
                e.stopPropagation();
                saveCustomThemePreset();
                return;
            }
            const applyPreset = el.closest('[data-preset-apply]');
            if (applyPreset) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                applyCustomThemePreset(applyPreset.getAttribute('data-preset-apply'));
                return;
            }
            const deletePreset = el.closest('[data-preset-delete]');
            if (deletePreset) {
                e.preventDefault();
                e.stopPropagation();
                deleteCustomThemePreset(parseInt(deletePreset.getAttribute('data-preset-delete'), 10));
            }
        }, true);
    }

    syncCustomThemeEditor();
}

function _shadeColor(hex, percent) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.max(0, Math.round(r + (255 - r) * percent / 100)));
    g = Math.min(255, Math.max(0, Math.round(g + (255 - g) * percent / 100)));
    b = Math.min(255, Math.max(0, Math.round(b + (255 - b) * percent / 100)));
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
function _darkenColor(hex, percent) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.max(0, Math.round(r * (1 - percent / 100)));
    g = Math.max(0, Math.round(g * (1 - percent / 100)));
    b = Math.max(0, Math.round(b * (1 - percent / 100)));
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a hex color to an "R, G, B" string for use in rgba().
 */
function _hexToRGB(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}

/**
 * Apply the selected color theme across the entire site.
 *
 * Injects CSS custom properties on :root and overrides all hardcoded
 * color references (rgba values, hex codes in <style> blocks) with
 * variable-based equivalents.
 *
 * Logo colors:
 *   - "user" layer  → textPrimary (theme's main text color)
 *   - "typ_" layer  → accentPrimary (theme's accent color)
 *   - "o" layer     → always red (#ff3344) across all themes
 */
/** Smoothly animate theme color changes for ~500ms (user switches only — never first paint). */
function beginThemeColorTransition() {
    const root = document.documentElement;
    if (!root) return;
    // Enable interpolating transitions, then force a style flush so the
    // upcoming palette change animates from the current computed colors.
    root.classList.add('theme-animating');
    void root.offsetWidth;
    if (window.__usertypoThemeAnimTimer) {
        clearTimeout(window.__usertypoThemeAnimTimer);
    }
    window.__usertypoThemeAnimTimer = setTimeout(() => {
        root.classList.remove('theme-animating');
        window.__usertypoThemeAnimTimer = null;
    }, 520);
}

/** Publish live theme CSS variables on :root (drives var()-based surfaces). */
function publishThemeCssVars(p, derived) {
    const root = document.documentElement;
    if (!root || !p || !derived) return;
    const {
        accentRGB, bgMainRGB, bgSecRGB, errorRGB,
        onPrimary, fgStrong, ringTrack, themeIsLight, glowFactor, glowPct,
    } = derived;
    root.style.setProperty('--theme-primary', p.accentPrimary);
    root.style.setProperty('--theme-primary-rgb', accentRGB);
    root.style.setProperty('--theme-primary-hover', p.accentHover);
    root.style.setProperty('--theme-bg', p.bgMain);
    root.style.setProperty('--theme-bg-rgb', bgMainRGB);
    root.style.setProperty('--theme-bg-secondary', p.bgSecondary);
    root.style.setProperty('--theme-bg-secondary-rgb', bgSecRGB);
    root.style.setProperty('--theme-menu-bg', `rgba(${bgSecRGB}, 0.4)`);
    root.style.setProperty('--theme-text', p.textPrimary);
    root.style.setProperty('--theme-text-muted', p.textMuted);
    root.style.setProperty('--theme-error', p.error);
    root.style.setProperty('--theme-error-rgb', errorRGB);
    root.style.setProperty('--theme-on-primary', onPrimary);
    root.style.setProperty('--theme-fg-strong', fgStrong);
    root.style.setProperty('--theme-ring-track', ringTrack);
    root.style.setProperty('--theme-is-light', themeIsLight ? '1' : '0');
    if (glowFactor != null) root.style.setProperty('--glow-intensity', String(glowFactor));
    if (glowPct != null) root.setAttribute('data-glow-intensity', String(glowPct));
}

/** Clamp glow intensity to 0–100. Missing/invalid → host default (100 live / 50 staging). */
function normalizeGlowIntensity(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return getDefaultGlowIntensity();
    return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Set --gi-XX CSS custom properties on :root for each glow alpha step.
 * Each --gi-N equals (N/100) × glowFactor, giving a pre-computed alpha
 * that can be used inside rgba() via var(--gi-N) without calc().
 *
 * This replaces the broken calc() inside rgba() pattern that browsers
 * silently invalidate, causing glow to be uncontrollable.
 */
function setGlowAlphaProperties(root, factor) {
    for (let step = 0; step <= 100; step++) {
        root.style.setProperty('--gi-' + step, String(Math.round(((step / 100) * factor) * 10000) / 10000));
    }
    // Percentage form for color-mix() usage
    root.style.setProperty('--glow-pct', String(Math.round(factor * 100)) + '%');
}

/**
 * Publish --glow-intensity (0–1) and update all --gi-XX alpha properties.
 * Theme CSS and page CSS reference var(--gi-XX) so glows update instantly.
 */
function applyGlowIntensityVar(settings) {
    if (!settings) settings = loadSettings();
    const pct = normalizeGlowIntensity(settings.lookFeel?.glowIntensity);
    const factor = pct / 100;
    try {
        const root = document.documentElement;
        root.style.setProperty('--glow-intensity', String(factor));
        root.setAttribute('data-glow-intensity', String(pct));
        setGlowAlphaProperties(root, factor);
        if (!settings.lookFeel) settings.lookFeel = {};
        settings.lookFeel.glowIntensity = pct;
        document.querySelectorAll('[data-glow-intensity-value]').forEach((el) => {
            el.textContent = `${pct}%`;
        });
    } catch { /* ignore */ }
    return factor;
}

/**
 * Rewrite glow alphas in generated theme CSS to:
 *   calc(<authored-alpha> * var(--glow-intensity, 1))
 * so each glow keeps its relative strength while the slider scales them all.
 * Pure-black depth shadows are left alone. Solid-color drop-shadows become
 * rgba(..., calc(1 * var(--glow-intensity))) so they can fade to nothing.
 */
function embedGlowIntensityInCss(css) {
    const wrapRgbaInValue = (value, { includeBlack = false } = {}) => value.replace(
        /rgba\(\s*([+\d.eE-]+)\s*,\s*([+\d.eE-]+)\s*,\s*([+\d.eE-]+)\s*,\s*([+\d.eE-]+)\s*\)/g,
        (m, r, g, b, a) => {
            if (String(a).includes('var(--gi-')) return m;
            if (!includeBlack && +r === 0 && +g === 0 && +b === 0) return m;
            const giKey = Math.round(parseFloat(a) * 100);
            return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, var(--gi-${giKey}, ${a}))`;
        }
    );

    const wrapSolidDropShadows = (value) => value.replace(
        /drop-shadow\(\s*(0\s+0\s+[+\d.eE-]+px)\s+(#[0-9a-fA-F]{3,8})\s*\)/g,
        (m, offsetBlur, hex) => {
            let h = hex.slice(1);
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            if (h.length !== 6) return m;
            const r = parseInt(h.slice(0, 2), 16);
            const g = parseInt(h.slice(2, 4), 16);
            const b = parseInt(h.slice(4, 6), 16);
            if (![r, g, b].every(Number.isFinite)) return m;
            return `drop-shadow(${offsetBlur} rgba(${r}, ${g}, ${b}, var(--gi-100, 1)))`;
        }
    ).replace(
        /drop-shadow\(\s*(0\s+0\s+[+\d.eE-]+px)\s+(var\([^)]+\))\s*\)/g,
        (m, offsetBlur, colorVar) =>
            `drop-shadow(${offsetBlur} color-mix(in srgb, ${colorVar} var(--glow-pct, 100%), transparent))`
    );

    let out = css.replace(
        /((?:-webkit-)?(?:box-shadow|text-shadow|filter))\s*:\s*([^;{}]+)/gi,
        (full, prop, value) => {
            const propL = prop.toLowerCase();
            let next = value;
            if (propL.includes('filter')) {
                next = wrapSolidDropShadows(next);
                next = wrapRgbaInValue(next, { includeBlack: true });
            } else if (propL.includes('text-shadow')) {
                next = wrapRgbaInValue(next, { includeBlack: true });
            } else {
                // box-shadow: include ALL colors (even black accents).
                next = wrapRgbaInValue(next, { includeBlack: true });
            }
            return `${prop}: ${next}`;
        }
    );

    // Ambient radial wash used as a page glow (not a box-shadow)
    out = out.replace(
        /(ellipse 70% 55% at 50% 38%, rgba\(\s*[+\d.eE-]+\s*,\s*[+\d.eE-]+\s*,\s*[+\d.eE-]+\s*,\s*)([+\d.eE-]+)(\s*\) 0%)/g,
        (m, pre, a, post) => {
            if (String(a).includes('var(--gi-')) return m;
            const giKey = Math.round(parseFloat(a) * 100);
            return `${pre}var(--gi-${giKey}, ${a})${post}`;
        }
    );

    return out;
}

function applyThemeSettings(settings) {
    if (!settings) settings = loadSettings();
    const themeName = settings.lookFeel?.colorTheme || getPreferredDefaultTheme();
    const p = resolveThemePalette(settings, themeName);
    const glowPct = normalizeGlowIntensity(settings.lookFeel?.glowIntensity);
    const glowFactor = glowPct / 100;

    // ── Font Family ──
    const fontFamily = settings.lookFeel?.fontFamily || 'Roboto Mono';
    if (typeof window.usertypoEnsureFontLoaded === 'function') {
        window.usertypoEnsureFontLoaded(fontFamily);
    }

    // Derived colors
    const accentDark = _darkenColor(p.accentPrimary, 30);
    const accentLight = _shadeColor(p.accentPrimary, 20);
    const bgDark = _darkenColor(p.bgMain, 20);
    const bgLight = _shadeColor(p.bgSecondary, 15);
    const accentRGB = _hexToRGB(p.accentPrimary);
    const bgSecRGB = _hexToRGB(p.bgSecondary);
    const errorRGB = _hexToRGB(p.error);
    const textPriRGB = _hexToRGB(p.textPrimary);
    const bgMainRGB = _hexToRGB(p.bgMain);
    const themeIsLight = getHexLuminance(p.bgMain) > 0.55;
    // High-contrast foreground for live stats / progress on light & dark surfaces
    const fgStrong = themeIsLight
        ? (getHexLuminance(p.textPrimary) < 0.45 ? p.textPrimary : '#222222')
        : (getHexLuminance(p.textPrimary) > 0.6 ? p.textPrimary : '#ffffff');
    const ringTrack = themeIsLight ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.12)';
    const panelBorder = themeIsLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.08)';

    // Logo: typ_ = accentPrimary (main), user = textPrimary (secondary)
    const logoTypColor = p.accentPrimary;
    const logoUserColor = p.textPrimary; // user layer
    const logoTypRGB = _hexToRGB(logoTypColor);
    const logoUserRGB = _hexToRGB(logoUserColor);

    // Contrasting text color for labels on primary-filled buttons (Ready Up, Rematch, etc.)
    const _accentLum = (() => {
        const r = parseInt(p.accentPrimary.slice(1, 3), 16);
        const g = parseInt(p.accentPrimary.slice(3, 5), 16);
        const b = parseInt(p.accentPrimary.slice(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    })();
    const onPrimary = _accentLum > 0.55 ? _darkenColor(p.accentPrimary, 65) : '#ffffff';

    // Animate only when switching away from an already-applied palette.
    // First paint (Abyss/Paper boot → saved theme) must be instant — otherwise
    // hardcoded shell cyan (#00d0ff / #95efff) morphs visibly in the middle.
    const themeKey = `${themeName}|${p.bgMain}|${p.accentPrimary}|${p.textPrimary}|${p.textMuted}|${p.bgSecondary}|${p.error}`;
    const shouldAnimateTheme = !!(__lastAppliedThemeKey && __lastAppliedThemeKey !== themeKey);
    if (shouldAnimateTheme) {
        beginThemeColorTransition();
        // Push CSS vars immediately (before the big stylesheet rewrite) so
        // var(--theme-*) surfaces start interpolating from the current frame.
        publishThemeCssVars(p, {
            accentRGB, bgMainRGB, bgSecRGB, errorRGB,
            onPrimary, fgStrong, ringTrack, themeIsLight,
            glowFactor, glowPct,
        });
        try {
            const root = document.documentElement;
            root.style.backgroundColor = p.bgMain;
            if (document.body) document.body.style.backgroundColor = p.bgMain;
            const backdrop = document.getElementById('app-backdrop');
            if (backdrop) backdrop.style.backgroundColor = p.bgMain;
            const spaContent = document.getElementById('spa-content');
            if (spaContent) spaContent.style.backgroundColor = p.bgMain;
        } catch (e) { /* ignore */ }
    }
    __lastAppliedThemeKey = themeKey;

    // Escape a Tailwind arbitrary-value class for use inside a CSS stylesheet string
    const _escTw = (cls) => cls
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/\./g, '\\.')
        .replace(/\//g, '\\/')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/,/g, '\\,')
        .replace(/#/g, '\\#');

    // Build theme-aware overrides for every known hardcoded blue glow/shadow class
    const shadowSpecs = [
        ['shadow-[0_0_5px_rgba(108,218,255,0.3)]', `0 0 5px rgba(${accentRGB}, 0.3)`],
        ['shadow-[0_0_8px_rgba(108,218,255,0.4)]', `0 0 8px rgba(${accentRGB}, 0.4)`],
        ['shadow-[0_0_8px_rgba(0,208,255,0.3)]', `0 0 8px rgba(${accentRGB}, 0.3)`],
        ['shadow-[0_0_10px_rgba(0,208,255,0)]', `0 0 10px rgba(${accentRGB}, 0)`],
        ['shadow-[0_0_10px_rgba(0,208,255,0.2)]', `0 0 10px rgba(${accentRGB}, 0.2)`],
        ['shadow-[0_0_10px_rgba(0,208,255,0.3)]', `0 0 10px rgba(${accentRGB}, 0.3)`],
        ['shadow-[0_0_10px_rgba(0,208,255,0.4)]', `0 0 10px rgba(${accentRGB}, 0.4)`],
        ['shadow-[0_0_10px_rgba(0,208,255,0.5)]', `0 0 10px rgba(${accentRGB}, 0.5)`],
        ['shadow-[0_0_12px_rgba(0,208,255,0.25)]', `0 0 12px rgba(${accentRGB}, 0.25)`],
        ['shadow-[0_0_15px_rgba(0,208,255,0.15)]', `0 0 15px rgba(${accentRGB}, 0.15)`],
        ['shadow-[0_0_15px_rgba(0,208,255,0.4)]', `0 0 15px rgba(${accentRGB}, 0.4)`],
        ['shadow-[0_0_20px_rgba(0,208,255,0.15)]', `0 0 20px rgba(${accentRGB}, 0.15)`],
        ['shadow-[0_0_20px_rgba(0,208,255,0.3)]', `0 0 20px rgba(${accentRGB}, 0.3)`],
        ['shadow-[0_0_20px_rgba(0,208,255,0.4)]', `0 0 20px rgba(${accentRGB}, 0.4)`],
        ['shadow-[0_0_20px_rgba(0,208,255,0.15)]', `0 0 20px rgba(${accentRGB}, 0.15)`],
        ['shadow-[inset_0_0_20px_rgba(0,208,255,0.05)]', `inset 0 0 20px rgba(${accentRGB}, 0.05)`],
        ['hover:shadow-[0_0_8px_rgba(0,208,255,0.4)]', `0 0 8px rgba(${accentRGB}, 0.4)`],
        ['hover:shadow-[0_0_10px_rgba(0,208,255,0.2)]', `0 0 10px rgba(${accentRGB}, 0.2)`],
        ['hover:shadow-[0_0_10px_rgba(0,208,255,0.3)]', `0 0 10px rgba(${accentRGB}, 0.3)`],
        ['hover:shadow-[0_0_15px_rgba(0,208,255,0.25)]', `0 0 15px rgba(${accentRGB}, 0.25)`],
        ['hover:shadow-[0_0_15px_rgba(0,208,255,0.3)]', `0 0 15px rgba(${accentRGB}, 0.3)`],
        ['hover:shadow-[0_0_15px_rgba(0,208,255,0.4)]', `0 0 15px rgba(${accentRGB}, 0.4)`],
        ['hover:shadow-[0_0_20px_rgba(0,208,255,0.4)]', `0 0 20px rgba(${accentRGB}, 0.4)`],
        ['hover:shadow-[0_0_30px_rgba(0,208,255,0.5)]', `0 0 30px rgba(${accentRGB}, 0.5)`],
    ];
    const dropShadowSpecs = [
        ['drop-shadow-[0_0_5px_rgba(0,208,255,0.4)]', `drop-shadow(0 0 5px rgba(${accentRGB}, 0.4))`],
        ['drop-shadow-[0_0_8px_rgba(0,208,255,0.4)]', `drop-shadow(0 0 8px rgba(${accentRGB}, 0.4))`],
        ['drop-shadow-[0_0_8px_rgba(0,208,255,0.8)]', `drop-shadow(0 0 8px rgba(${accentRGB}, 0.8))`],
        ['group-hover:drop-shadow-[0_0_8px_rgba(0,208,255,0.8)]', `drop-shadow(0 0 8px rgba(${accentRGB}, 0.8))`],
        ['[text-shadow:0_0_10px_rgba(0,208,255,0.8)]', null], // text-shadow handled below
        ['group-hover:[text-shadow:0_0_10px_rgba(0,208,255,0.8)]', null],
    ];
    const shadowOverrideCSS = shadowSpecs.map(([cls, val]) => {
        if (cls.startsWith('hover:')) {
            return `.${_escTw(cls)}:hover { box-shadow: ${val} !important; }`;
        }
        return `.${_escTw(cls)} { box-shadow: ${val} !important; }`;
    }).join('\n        ');
    const dropShadowOverrideCSS = dropShadowSpecs.filter(([, v]) => v).map(([cls, val]) => {
        if (cls.startsWith('group-hover:')) {
            return `.group:hover .${_escTw(cls)} { filter: ${val} !important; }`;
        }
        return `.${_escTw(cls)} { filter: ${val} !important; }`;
    }).join('\n        ');

    let css = `
        /* ── Theme CSS custom properties (usable by any page/JS) ── */
        :root {
            --theme-primary: ${p.accentPrimary};
            --theme-primary-rgb: ${accentRGB};
            --theme-primary-hover: ${p.accentHover};
            --theme-primary-dark: ${accentDark};
            --theme-primary-light: ${accentLight};
            --theme-bg: ${p.bgMain};
            --theme-bg-rgb: ${bgMainRGB};
            --theme-bg-secondary: ${p.bgSecondary};
            --theme-bg-secondary-rgb: ${bgSecRGB};
            --theme-menu-bg: rgba(${bgSecRGB}, 0.4);
            --theme-box-radius: 1.375rem;
            --settings-box-radius: 1.375rem;
            --theme-text: ${p.textPrimary};
            --theme-text-muted: ${p.textMuted};
            --theme-error: ${p.error};
            --theme-error-rgb: ${errorRGB};
            --theme-on-primary: ${onPrimary};
            --theme-fg-strong: ${fgStrong};
            --theme-ring-track: ${ringTrack};
            --theme-is-light: ${themeIsLight ? '1' : '0'};
            --theme-panel-border: ${panelBorder};
            --glow-intensity: ${glowFactor};
        }

        /* ── Dynamic Font Family ── */
        html, body,
        input, button, select, textarea,
        h1, h2, h3, h4, h5, h6,
        p, span, a, label, li, td, th, div,
        .font-mono, .font-sans,
        .opt-btn, .setting-select, .search-input, .danger-btn,
        [class*="font-"] {
            font-family: '${fontFamily}', monospace !important;
        }
        .material-symbols-outlined {
            font-family: 'Material Symbols Outlined' !important;
            font-feature-settings: 'liga' !important;
            -webkit-font-feature-settings: 'liga' !important;
        }
        /* ── Tailwind color class overrides ── */
        /* Primary / Accent */
        .text-primary { color: ${p.accentPrimary} !important; }
        .bg-primary { background-color: ${p.accentPrimary} !important; }
        .border-primary { border-color: ${p.accentPrimary} !important; }
        .border-l-primary { border-left-color: ${p.accentPrimary} !important; }
        .text-primary-dark { color: ${accentDark} !important; }
        .bg-primary-dark { background-color: ${accentDark} !important; }
        .text-primary-light { color: ${accentLight} !important; }
        .bg-primary-light { background-color: ${accentLight} !important; }
        .text-on-primary { color: ${onPrimary} !important; }
        .text-background-dark { color: ${bgDark} !important; }

        /* ── Gradient stop utilities (stats strip, podium cards, etc.) ── */
        .from-primary {
            --tw-gradient-from: ${p.accentPrimary} var(--tw-gradient-from-position) !important;
            --tw-gradient-to: rgba(${accentRGB}, 0) var(--tw-gradient-to-position) !important;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
        }
        .to-primary {
            --tw-gradient-to: ${p.accentPrimary} var(--tw-gradient-to-position) !important;
        }
        .via-primary {
            --tw-gradient-via: ${p.accentPrimary} var(--tw-gradient-via-position) !important;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to) !important;
        }

        /* Surface */
        .bg-surface { background-color: ${p.bgSecondary} !important; }
        .border-surface { border-color: ${p.bgSecondary} !important; }
        .bg-surface-light { background-color: ${bgLight} !important; }

        /* Material-style on-surface tokens (Tailwind hardcodes light-on-dark hex) */
        .text-on-surface { color: ${fgStrong} !important; }
        .text-on-surface-variant { color: ${p.textMuted} !important; }
        .text-on-surface\\/90 { color: rgba(${textPriRGB}, 0.92) !important; }
        .text-on-surface\\/80 { color: rgba(${textPriRGB}, 0.82) !important; }
        .text-on-surface\\/70 { color: rgba(${textPriRGB}, 0.72) !important; }
        .text-on-surface-variant\\/90 { color: rgba(${_hexToRGB(p.textMuted)}, 0.9) !important; }
        .text-on-surface-variant\\/80 { color: rgba(${_hexToRGB(p.textMuted)}, 0.8) !important; }
        .bg-on-surface { background-color: ${fgStrong} !important; }
        .bg-on-surface-variant { background-color: ${p.textMuted} !important; }
        .border-on-surface { border-color: ${fgStrong} !important; }
        .border-on-surface-variant { border-color: ${p.textMuted} !important; }

        /* Shell menu links — beat page-level hardcoded #cbd5e1/#fff (home.html) */
        .bubble-nav-link {
            color: ${p.textMuted} !important;
        }
        .bubble-nav-link:hover {
            color: ${fgStrong} !important;
            background-color: ${themeIsLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)'} !important;
        }
        .bubble-nav-link.is-active {
            color: ${p.accentPrimary} !important;
            background-color: ${themeIsLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)'} !important;
        }
        .bubble-nav-link .nav-icon {
            color: inherit !important;
        }
        .bubble-nav-link:hover .nav-icon,
        .bubble-nav-link.is-active .nav-icon {
            color: ${p.accentPrimary} !important;
            text-shadow: 0 0 10px rgba(${accentRGB}, ${themeIsLight ? '0.25' : '0.8'}) !important;
        }
        .menu-btn {
            color: ${p.textMuted} !important;
        }
        .menu-btn:hover {
            color: ${fgStrong} !important;
        }
        .menu-btn.is-active {
            color: ${p.accentPrimary} !important;
        }

        /* Graph / pot / friends tab pills */
        .graph-tab-pill button,
        .pot-tab-pill .pot-btn,
        .friends-tab-pill .friends-tab-btn {
            color: ${p.textMuted} !important;
        }
        .graph-tab-pill button.active,
        .pot-tab-pill .pot-btn.is-active,
        .friends-tab-pill .friends-tab-btn.active {
            color: ${fgStrong} !important;
        }

        /* Stats CTA — Next Test was hardcoded bg-white */
        #stats-action-buttons button.bg-white,
        #stats-action-buttons > button:first-child {
            background-color: ${p.accentPrimary} !important;
            color: ${onPrimary} !important;
            box-shadow: 0 0 28px rgba(${accentRGB}, ${themeIsLight ? '0.28' : '0.45'}) !important;
        }
        #stats-action-buttons button.bg-white:hover,
        #stats-action-buttons > button:first-child:hover {
            box-shadow: 0 0 42px rgba(${accentRGB}, ${themeIsLight ? '0.4' : '0.6'}) !important;
        }
        #stats-action-buttons button.bg-white .bg-black\\/15,
        #stats-action-buttons > button:first-child .bg-black\\/15,
        #stats-action-buttons .bg-primary .bg-black\\/15 {
            background-color: ${_accentLum > 0.55 ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.18)'} !important;
        }
        #stats-action-buttons button.bg-white .text-black\\/60,
        #stats-action-buttons > button:first-child .text-black\\/60,
        #stats-action-buttons .bg-primary .text-black\\/60 {
            color: ${_accentLum > 0.55 ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.7)'} !important;
        }

        /* Background */
        .bg-background { background-color: ${p.bgMain} !important; }
        .bg-background-dark { background-color: ${bgDark} !important; }

        /* Error */
        .text-error { color: ${p.error} !important; }
        .bg-error { background-color: ${p.error} !important; }
        .border-error { border-color: ${p.error} !important; }

        /* ── Opacity variants (Tailwind generates these as rgba) ── */
        .bg-primary\\/5 { background-color: rgba(${accentRGB}, 0.05) !important; }
        .bg-primary\\/10 { background-color: rgba(${accentRGB}, 0.1) !important; }
        .bg-primary\\/15 { background-color: rgba(${accentRGB}, 0.15) !important; }
        .bg-primary\\/20 { background-color: rgba(${accentRGB}, 0.2) !important; }
        .bg-primary\\/30 { background-color: rgba(${accentRGB}, 0.3) !important; }
        .bg-primary\\/40 { background-color: rgba(${accentRGB}, 0.4) !important; }
        .bg-primary\\/50 { background-color: rgba(${accentRGB}, 0.5) !important; }
        .bg-primary\\/60 { background-color: rgba(${accentRGB}, 0.6) !important; }
        .bg-primary\\/80 { background-color: rgba(${accentRGB}, 0.8) !important; }
        .bg-surface\\/40 { background-color: var(--theme-menu-bg) !important; }
        .bg-surface\\/60 { background-color: var(--theme-menu-bg) !important; }
        .bg-surface\\/80 { background-color: var(--theme-menu-bg) !important; }
        .bg-surface\\/85 { background-color: var(--theme-menu-bg) !important; }
        .bg-surface\\/90 { background-color: var(--theme-menu-bg) !important; }
        /* Nested UI chrome (inputs, chips, rows) — same menu glass, not darker black washes */
        .bg-black\\/10,
        .bg-black\\/20,
        .bg-black\\/25,
        .bg-black\\/30,
        .bg-black\\/40,
        .bg-white\\/\\[0\\.03\\],
        .bg-white\\/\\[0\\.035\\],
        .bg-white\\/\\[0\\.04\\],
        .bg-slate-900,
        .bg-slate-900\\/40,
        .bg-slate-950 {
            background-color: var(--theme-menu-bg) !important;
            background-image: none !important;
        }
        /* Never keep Tailwind blur-md (12px) on chrome — menu uses 4px */
        .backdrop-blur-md,
        .backdrop-blur-lg,
        .backdrop-blur-xl {
            --tw-backdrop-blur: blur(4px) !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
        }
        .border-primary\\/20 { border-color: rgba(${accentRGB}, 0.2) !important; }
        .border-primary\\/30 { border-color: rgba(${accentRGB}, 0.3) !important; }
        .border-primary\\/40 { border-color: rgba(${accentRGB}, 0.4) !important; }
        .border-primary\\/50 { border-color: rgba(${accentRGB}, 0.5) !important; }
        .border-primary\\/25 { border-color: rgba(${accentRGB}, 0.25) !important; }
        .text-primary\\/60 { color: rgba(${accentRGB}, 0.6) !important; }
        .text-primary\\/70 { color: rgba(${accentRGB}, 0.7) !important; }
        .text-primary\\/80 { color: rgba(${accentRGB}, 0.8) !important; }
        .border-error\\/30 { border-color: rgba(${errorRGB}, 0.3) !important; }

        /* ── Focus ring / border utilities (search bars, chat inputs, etc.) ── */
        .focus\\:border-primary:focus { border-color: ${p.accentPrimary} !important; }
        .focus\\:border-primary\\/50:focus { border-color: rgba(${accentRGB}, 0.5) !important; }
        .focus\\:border-primary\\/60:focus { border-color: rgba(${accentRGB}, 0.6) !important; }
        .focus\\:ring-primary\\/30:focus { --tw-ring-color: rgba(${accentRGB}, 0.3) !important; }
        .focus\\:ring-primary\\/40:focus { --tw-ring-color: rgba(${accentRGB}, 0.4) !important; }
        .focus\\:ring-1:focus { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000) !important; }

        /* Catch-all: any input/select carrying Tailwind focus:border-primary* classes */
        input[class*="focus:border-primary"]:focus,
        select[class*="focus:border-primary"]:focus,
        textarea[class*="focus:border-primary"]:focus {
            border-color: rgba(${accentRGB}, 0.5) !important;
            outline: none !important;
            --tw-ring-color: rgba(${accentRGB}, 0.3) !important;
        }
        input[class*="focus:ring-primary"]:focus,
        select[class*="focus:ring-primary"]:focus {
            --tw-ring-color: rgba(${accentRGB}, 0.35) !important;
            --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) rgba(${accentRGB}, 0.35) !important;
            box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000) !important;
        }

        /* Dedicated theme-aware focus class (preferred over Tailwind focus:border-primary) */
        .theme-focus:focus,
        .theme-focus:focus-visible {
            border-color: rgba(${accentRGB}, 0.5) !important;
            outline: none !important;
            box-shadow: 0 0 0 1px rgba(${accentRGB}, 0.35) !important;
        }

        /* ── Hover variants ── */
        .hover\\:text-primary:hover { color: ${p.accentPrimary} !important; }
        .hover\\:bg-primary:hover { background-color: ${p.accentPrimary} !important; }
        .hover\\:bg-primary\\/20:hover { background-color: rgba(${accentRGB}, 0.2) !important; }
        .hover\\:bg-primary\\/90:hover { background-color: rgba(${accentRGB}, 0.9) !important; }
        .hover\\:text-on-primary:hover { color: ${onPrimary} !important; }
        .hover\\:border-primary:hover { border-color: ${p.accentPrimary} !important; }
        .hover\\:border-primary\\/30:hover { border-color: rgba(${accentRGB}, 0.3) !important; }
        .hover\\:border-primary\\/50:hover { border-color: rgba(${accentRGB}, 0.5) !important; }
        .group-hover\\:text-primary { color: inherit; }
        .group:hover .group-hover\\:text-primary { color: ${p.accentPrimary} !important; }

        /* ── Text shadow overrides for accent glow ── */
        [style*="text-shadow"][style*="0,208,255"],
        [style*="text-shadow"][style*="0, 208, 255"],
        .text-primary[style*="text-shadow"] {
            text-shadow: 0 0 10px rgba(${accentRGB}, 0.6) !important;
        }

        /* ── Exhaustive Tailwind JIT shadow / drop-shadow overrides ── */
        ${shadowOverrideCSS}
        ${dropShadowOverrideCSS}
        .\\[text-shadow\\:0_0_10px_rgba\\(0\\,208\\,255\\,0\\.8\\)\\] { text-shadow: 0 0 10px rgba(${accentRGB}, 0.8) !important; }
        .group:hover .group-hover\\:\\[text-shadow\\:0_0_10px_rgba\\(0\\,208\\,255\\,0\\.8\\)\\] { text-shadow: 0 0 10px rgba(${accentRGB}, 0.8) !important; }
        .hover\\:\\[text-shadow\\:0_0_10px_rgba\\(0\\,208\\,255\\,0\\.8\\)\\]:hover { text-shadow: 0 0 10px rgba(${accentRGB}, 0.8) !important; }

        /* ── Base backgrounds ── */
        html,
        body {
            background-color: ${p.bgMain} !important;
        }
        #app-body,
        #spa-page-root,
        #spa-shell-footer,
        body > header {
            color: ${p.textMuted};
            background-color: transparent !important;
        }
        #spa-content,
        #app-backdrop,
        #spa-boot-overlay {
            background-color: ${p.bgMain} !important;
        }
        [style*="background-color: #020016"],
        [style*="background:#020016"],
        .fixed.inset-0.z-0,
        div[style*="background-color"][style*="020016"] { background-color: ${p.bgMain} !important; }
        /* Radial glow overlay */
        div[style*="radial-gradient"] { background: radial-gradient(ellipse 70% 55% at 50% 38%, rgba(${accentRGB}, 0.05) 0%, transparent 72%) !important; }

        /* ── Live typing chrome — readable on light themes (Paper, Matcha, …) ── */
        #word-progress,
        #room-word-progress,
        #wpm-display,
        #acc-display,
        #burst-display,
        #bot-wpm-display,
        #room-wpm-display,
        #room-acc-display,
        #room-burst-display {
            color: ${fgStrong} !important;
            text-shadow: 0 0 8px rgba(${_hexToRGB(fgStrong)}, ${themeIsLight ? '0.15' : '0.45'}) !important;
        }
        #word-progress-bar-container,
        #room-word-progress-bar-container {
            background-color: ${themeIsLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.1)'} !important;
        }
        #word-progress-bar,
        #room-word-progress-bar {
            background-color: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, ${themeIsLight ? '0.35' : '0.8'}) !important;
        }

        /* ── Light themes: remap dark-UI hardcoded whites / slate-100s ── */
        ${themeIsLight ? `
        /* Hardcoded near-white text → readable on Paper / light themes */
        .text-white,
        .text-slate-50,
        .text-slate-100,
        .text-slate-200,
        #stats-raw-wpm,
        #stats-max-burst,
        #stats-wpm,
        #stats-acc,
        #stats-consistency,
        #stats-time,
        #level-up-number,
        #fail-title,
        #shell-user-name,
        #shell-user-tier,
        #ppc-username,
        #ppc-stat-tests,
        #ppc-stat-time,
        #ppc-stat-words,
        #generated-room-id,
        .about-stat-value,
        .hiw-eq,
        .hiw-eq-result,
        .graph-tab-pill button.active,
        .graph-info-label,
        .bubble-toggle-icon,
        .expanding-bubble:not(.is-open):hover .bubble-toggle-icon,
        .contact-pill-input,
        .contact-pill-textarea,
        .contact-problem-option:hover,
        .contact-problem-option:focus-visible,
        .opt-btn:hover,
        .white-link:hover,
        .lb-username,
        .friends-name,
        .room-player-name,
        .dual-player-name {
            color: ${fgStrong} !important;
            text-shadow: none !important;
            filter: none !important;
        }
        .text-slate-300,
        .text-slate-400 {
            color: ${p.textMuted} !important;
        }
        .hover\\:text-white:hover,
        .group:hover .group-hover\\:text-white,
        .group-hover\\:text-white,
        .menu-btn:hover,
        a.hover\\:text-white:hover,
        button.hover\\:text-white:hover {
            color: ${p.accentPrimary} !important;
            text-shadow: 0 0 8px rgba(${accentRGB}, 0.18) !important;
        }
        .menu-btn.is-active {
            color: ${p.accentPrimary} !important;
            text-shadow: 0 0 10px rgba(${accentRGB}, 0.22) !important;
        }
        .hover\\:drop-shadow-\\[0_0_8px_rgba\\(255\\,255\\,255\\,0\\.8\\)\\]:hover {
            filter: drop-shadow(0 0 6px rgba(${accentRGB}, 0.25)) !important;
        }
        .drop-shadow-\\[0_0_8px_rgba\\(255\\,255\\,255\\,0\\.6\\)\\] {
            filter: none !important;
        }
        /* Soften white-tinted chips / inputs on light Paper */
        .bg-white\\/5,
        .bg-white\\/10,
        .hover\\:bg-white\\/5:hover,
        .hover\\:bg-white\\/10:hover,
        .hover\\:bg-white\\/20:hover,
        .bg-black\\/20,
        .bg-black\\/40 {
            background-color: rgba(0, 0, 0, 0.06) !important;
        }
        .border-white\\/5,
        .border-white\\/10,
        .border-white\\/50,
        .hover\\:border-white\\/50:hover {
            border-color: rgba(0, 0, 0, 0.12) !important;
        }
        .placeholder\\:text-slate-500::placeholder,
        .contact-pill-input::placeholder,
        .contact-pill-textarea::placeholder {
            color: ${p.textMuted} !important;
        }
        /* Explicit lobby / room chrome */
        #lobby-room-name,
        #lobby-room-id,
        #lobby-mode-text,
        #lobby-modifiers-text,
        #invite-panel-room-id,
        #invite-panel-join-link,
        #lobby-test-config {
            color: ${fgStrong} !important;
        }
        #lobby-room-id,
        #lobby-modifiers-text,
        #invite-panel-join-link,
        .text-on-surface-variant {
            color: ${p.textMuted} !important;
        }

        .privacy-page h1, .privacy-page h2, .privacy-page h3,
        .terms-page h1, .terms-page h2, .terms-page h3,
        .security-page h1, .security-page h2, .security-page h3,
        .about-page h1, .about-page h2, .about-page h3,
        .hiw-page h1, .hiw-page h2, .hiw-page h3,
        .privacy-page, .terms-page, .security-page,
        .about-page, .hiw-page,
        .about-page p, .hiw-page p,
        .privacy-page p, .terms-page p, .security-page p,
        #multiplayer-page h1, #multiplayer-page h2, #multiplayer-page h3,
        #multiplayer-page .text-white,
        #multiplayer-page .text-slate-100,
        #multiplayer-page .text-slate-200,
        [class*="privacy"] .text-slate-100,
        [class*="terms"] .text-slate-100,
        [class*="security"] .text-slate-100 {
            color: ${fgStrong} !important;
        }
        .privacy-page .text-slate-400,
        .terms-page .text-slate-400,
        .security-page .text-slate-400,
        .about-page .text-slate-400,
        .hiw-page .text-slate-400,
        .about-stat-label,
        .about-toc a,
        .hiw-toc a,
        #multiplayer-page .text-slate-400,
        #multiplayer-page .text-slate-300,
        #multiplayer-page p {
            color: ${p.textMuted} !important;
        }
        strong.text-slate-100,
        strong.text-slate-200,
        #multiplayer-page strong {
            color: ${fgStrong} !important;
        }
        /* Settings / search overlays that force white on hover */
        #global-settings-search-overlay .opt-btn:hover {
            color: ${fgStrong} !important;
            background: rgba(0, 0, 0, 0.06) !important;
        }
        ` : ''}

        /* ── Level / XP rings — visible track + contrast badge text ── */
        .player-level-avatar__track,
        #header-account-xp-track,
        #profile-xp-track {
            stroke: ${ringTrack} !important;
        }
        .player-level-avatar__progress,
        #header-account-xp-ring,
        #profile-xp-ring {
            stroke: ${p.accentPrimary} !important;
        }
        .player-level-avatar__level,
        #header-account-level,
        #profile-level-badge {
            background-color: ${p.accentPrimary} !important;
            color: ${onPrimary} !important;
        }
        .player-level-avatar__photo {
            border-color: ${panelBorder} !important;
            background: ${themeIsLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(26, 29, 35, 0.85)'} !important;
        }

        #profile-xp-track,
        #profile-xp-ring {
            stroke-width: 2 !important;
        }
        #header-account-xp-track,
        #header-account-xp-ring {
            stroke-width: 2.75 !important;
        }

        /*
         * ── Shared menu-bubble glass (source of truth: #expanding-bubble.is-open) ──
         * Fill: --theme-menu-bg (bgSecondary @ 0.4). Blur: 4px. No gradient.
         * Every surface, modal, toast, tip, and panel uses this exact material.
         */
        .glass-panel,
        .glass-card,
        .panel-surface,
        #sidebar-menu,
        #expanding-bubble,
        .pot-filter-bubble,
        #usertypo-cookie-banner .usertypo-cookie-banner__inner,
        #contact-box,
        #system-confirm-box,
        #custom-prompt-box,
        #player-profile-box,
        #avatar-editor-box,
        .contact-problem-menu,
        #graph-tooltip,
        .pot-graph-tooltip,
        .custom-popover,
        .usertypo-menu-pill-tip,
        .notification-toast,
        #dual-pending-inner,
        #settings-nav-pill,
        .settings-panel-card,
        #panel-card,
        .search-input,
        .quick-btn,
        .quick-btn-tooltip,
        .search-result-item,
        .setting-info-popover,
        #save-toast > div,
        #info-portal,
        .setting-select,
        .sub-card-header,
        .opt-btn:not(.active):not(.highlighted),
        .footer-pill,
        #footer-picker-box,
        .footer-picker-search,
        .footer-picker-pill,
        .footer-picker-theme-preview,
        .footer-picker-list-item:not(.is-active),
        .lb-country-panel,
        #global-settings-search-overlay .quick-btn-tooltip,
        .coming-soon-setting[data-coming-soon]:hover::after,
        #lobby-chat-toggle-btn[data-coming-soon]:hover::after,
        #orbit-tooltip-portal,
        .theme-color-hex,
        .custom-preset-card,
        .about-math,
        .about-toc,
        .hiw-toc,
        .hiw-card,
        .hiw-step,
        .privacy-toc,
        .terms-toc,
        .security-toc,
        #lb-country-search,
        #friends-filter-input,
        #add-friends-search-input,
        #custom-prompt-input,
        #contact-modal .contact-pill-input,
        #contact-modal .contact-pill-textarea,
        #contact-modal input[type="text"],
        #contact-modal input[type="email"],
        #contact-modal textarea,
        #contact-modal #contact-problem-btn,
        .testActivity .yearSelectButton,
        .testActivity .yearSelectMenu,
        .pot-tab-pill,
        .pot-preset-chip:not(.is-active),
        .graph-tab-pill,
        #back-to-top-btn,
        #back-to-top-btn:hover,
        #shell-user-card,
        .player-pill:not(.me),
        #live-leaderboard .lb-pill:not(.me),
        .toggle-track:not(.on),
        thead.bg-surface\\/80,
        #leaderboards-table thead,
        .custom-popover input,
        .custom-popover button {
            background: var(--theme-menu-bg) !important;
            background-color: var(--theme-menu-bg) !important;
            background-image: none !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
        }
        /*
         * Open / floating chrome — same border + shadow as #expanding-bubble.is-open.
         * (Fill + blur already set above; this adds the open-menu outline.)
         */
        .usertypo-menu-pill-tip,
        .score-distribution-column::after,
        .testActivity .activity div[aria-label]:hover::after,
        #expanding-bubble.is-open,
        .pot-filter-bubble.is-open,
        #contact-box,
        #system-confirm-box,
        #custom-prompt-box,
        #player-profile-box,
        #avatar-editor-box,
        .contact-problem-menu,
        #graph-tooltip,
        .pot-graph-tooltip,
        .lb-country-panel,
        .custom-popover,
        #global-settings-search-overlay .quick-btn-tooltip,
        .coming-soon-setting[data-coming-soon]:hover::after,
        #lobby-chat-toggle-btn[data-coming-soon]:hover::after,
        #orbit-tooltip-portal,
        .quick-btn-tooltip,
        .testActivity .yearSelectMenu {
            border: 1px solid ${themeIsLight ? 'rgba(0, 0, 0, 0.10)' : 'rgba(255, 255, 255, 0.05)'} !important;
            box-shadow: 0 20px 50px rgba(0, 0, 0, ${themeIsLight ? '0.18' : '0.5'}) !important;
        }
        .usertypo-menu-pill-tip,
        .score-distribution-column::after,
        .testActivity .activity div[aria-label]:hover::after,
        #global-settings-search-overlay .quick-btn-tooltip,
        .coming-soon-setting[data-coming-soon]:hover::after,
        #lobby-chat-toggle-btn[data-coming-soon]:hover::after,
        #orbit-tooltip-portal,
        .quick-btn-tooltip {
            color: ${p.textPrimary} !important;
        }
        /* Contact fields — same menu glass (not darker nested black) */
        #contact-modal .contact-pill-input,
        #contact-modal .contact-pill-textarea,
        #contact-modal input[type="text"],
        #contact-modal input[type="email"],
        #contact-modal textarea,
        #contact-modal #contact-problem-btn {
            color: ${themeIsLight ? '#222222' : '#ffffff'} !important;
            border-color: rgba(255, 255, 255, 0.05) !important;
        }
        #contact-modal .contact-pill-input::placeholder,
        #contact-modal .contact-pill-textarea::placeholder {
            color: ${p.textMuted} !important;
        }

        #save-toast-inner {
            border-radius: var(--theme-box-radius, 1.375rem) !important;
        }
        .setting-select {
            padding-right: 0.7rem !important;
        }
        /* Nested wrappers — no outer box behind pills */
        #settings-panel .panel-body-inner .sub-setting-card,
        #settings-panel .panel-body-inner .sub-setting-card.glass-card,
        .sub-setting-card {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
        }

        /*
         * ── Shared box radius (source of truth: settings tabs = 1.375rem) ──
         * Rectangular chrome uses --theme-box-radius.
         * Circles / expanding bubbles are restored below and must stay circular.
         */
        .rounded,
        .rounded-md,
        .rounded-lg,
        .rounded-xl,
        .rounded-2xl,
        .rounded-3xl,
        .rounded-\\[1\\.25rem\\],
        .rounded-\\[1\\.15rem\\],
        .glass-panel,
        .glass-card,
        .panel-surface,
        #settings-nav-pill,
        .settings-panel-card,
        #panel-card,
        .card-label,
        .search-input,
        .quick-btn,
        .quick-btn-tooltip,
        .search-result-item,
        .setting-info-popover,
        #info-portal,
        .setting-select,
        .sub-card-header,
        .opt-btn,
        .danger-btn,
        .danger-zone,
        .footer-pill,
        #footer-picker-box,
        .footer-picker-search,
        .footer-picker-pill,
        .footer-picker-theme-preview,
        .footer-picker-list-item,
        .lb-country-panel,
        #lb-country-search,
        #contact-box,
        #system-confirm-box,
        #custom-prompt-box,
        #player-profile-box,
        #avatar-editor-box,
        .contact-problem-menu,
        .contact-problem-option,
        .contact-pill-input,
        .contact-pill-textarea,
        #contact-modal #contact-problem-btn,
        #custom-prompt-input,
        #graph-tooltip,
        .pot-graph-tooltip,
        .custom-popover,
        .usertypo-menu-pill-tip,
        .notification-toast,
        .notification-row,
        #dual-pending-inner,
        #save-toast > div,
        #save-toast-inner,
        #shell-user-card,
        .player-pill,
        #live-leaderboard .lb-pill,
        .about-toc,
        .about-math,
        .hiw-toc,
        .hiw-math,
        .hiw-card,
        .hiw-step,
        .hiw-table-wrap,
        .privacy-toc,
        .terms-toc,
        .security-toc,
        .theme-color-hex,
        .theme-color-swatch,
        .custom-theme-preview,
        .custom-preset-card,
        .pot-tab-pill,
        .pot-preset-chip,
        .graph-tab-pill,
        .testActivity .yearSelectButton,
        .testActivity .yearSelectMenu,
        .testActivity .yearSelectOption,
        .usertypo-cookie-banner__inner,
        .usertypo-cookie-btn,
        .coming-soon-setting[data-coming-soon]:hover::after,
        #lobby-chat-toggle-btn[data-coming-soon]:hover::after,
        #orbit-tooltip-portal,
        .bubble-nav-link,
        [data-ppc-best],
        .profile-stat-card {
            border-radius: var(--theme-box-radius, 1.375rem) !important;
        }
        .rounded-l-2xl,
        .rounded-l-xl,
        .rounded-l-lg {
            border-top-left-radius: var(--theme-box-radius, 1.375rem) !important;
            border-bottom-left-radius: var(--theme-box-radius, 1.375rem) !important;
        }
        .rounded-r-2xl,
        .rounded-r-xl,
        .rounded-r-lg {
            border-top-right-radius: var(--theme-box-radius, 1.375rem) !important;
            border-bottom-right-radius: var(--theme-box-radius, 1.375rem) !important;
        }
        /* True circles / expanding bubbles — never use box radius */
        #expanding-bubble,
        .expanding-bubble,
        .pot-filter-bubble,
        #menu-unread-dot,
        .player-level-avatar,
        .player-level-avatar__photo,
        .player-level-avatar__ring,
        .toggle-thumb,
        .header-account-fallback,
        #avatar-crop-stage,
        #back-to-top-btn {
            border-radius: 50% !important;
        }
        #expanding-bubble,
        .expanding-bubble {
            border-radius: 1.066rem !important;
        }
        .pot-filter-bubble {
            border-radius: 1.066rem !important;
        }
        .toggle-track,
        .toggle-thumb,
        .bg-spectrum-thumb,
        .panel-back-btn,
        .setting-info-btn,
        .search-clear-btn,
        .rounded-full {
            border-radius: 9999px !important;
        }
        /* But wide rounded-full controls (inputs/CTAs/chips) still use box radius */
        input.rounded-full,
        textarea.rounded-full,
        .contact-pill-input,
        .contact-pill-textarea,
        .footer-pill.rounded-full,
        .opt-btn.rounded-full,
        .setting-select.rounded-full,
        button.rounded-full.px-4,
        button.rounded-full.px-5,
        button.rounded-full.px-6,
        button.rounded-full.px-7,
        button.rounded-full.px-8,
        a.rounded-full.px-4,
        a.rounded-full.px-5,
        a.rounded-full.px-6,
        .usertypo-cookie-btn {
            border-radius: var(--theme-box-radius, 1.375rem) !important;
        }
        /* Keymap keys keep the original smaller radius (pre–box-radius unify) */
        .keymap-key {
            border-radius: 0.5rem !important;
        }

        /* ── Scrollbar thumb ── */
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(${accentRGB}, 0.2) !important; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(${accentRGB}, 0.4) !important; }
        #page-scroll-thumb { background: rgba(${accentRGB}, 0.4) !important; }
        #page-scroll-thumb:hover { background: rgba(${accentRGB}, 0.8) !important; }

        /* ── Graph pill indicator ── */
        .graph-pill-indicator {
            background: rgba(${accentRGB}, 0.18) !important;
            border-color: rgba(${accentRGB}, 0.5) !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.25) !important;
        }
        @keyframes pillGlow {
            0%, 100% { box-shadow: 0 0 8px rgba(${accentRGB}, 0.35); }
            50%      { box-shadow: 0 0 18px rgba(${accentRGB}, 0.6); }
        }

        /* ── Graph info ── */
        .graph-info-section-title { color: ${p.accentPrimary} !important; }
        .graph-info-tip { background: rgba(${accentRGB}, 0.06) !important; border-color: rgba(${accentRGB}, 0.15) !important; }
        .graph-info-tip .tip-label { color: ${p.accentPrimary} !important; }
        #graph-info-btn.info-active {
            box-shadow: 0 0 20px rgba(${accentRGB}, 0.4) !important;
            border-color: rgba(${accentRGB}, 0.5) !important;
        }

        /* ── Config bar glow ── */
        @keyframes configBarGlow {
            0%, 100% { box-shadow: 0 0 6px rgba(${accentRGB}, 0.5), 0 0 12px rgba(${accentRGB}, 0.2), 0 8px 32px rgba(0,0,0,0.3); }
            50%      { box-shadow: 0 0 18px rgba(${accentRGB}, 1), 0 0 35px rgba(${accentRGB}, 0.7), 0 0 55px rgba(${accentRGB}, 0.25), 0 8px 32px rgba(0,0,0,0.3); }
        }
        #config-bar > div,
        #config-bar > div[style] {
            border-color: rgba(${accentRGB}, 0.5) !important;
            box-shadow: 0 0 6px rgba(${accentRGB}, 0.5), 0 0 12px rgba(${accentRGB}, 0.2), 0 8px 32px rgba(0,0,0,0.3);
            animation: configBarGlow 3s ease-in-out infinite;
        }
        #config-bar:hover > div,
        #config-bar:hover > div[style],
        #config-bar.is-open > div,
        #config-bar.is-open > div[style] {
            box-shadow: 0 0 8px rgba(${accentRGB}, 0.3), 0 8px 32px rgba(0,0,0,0.3) !important;
            animation: none !important;
        }

        /* ── Error underline ── */
        .char.error-underline { text-decoration-color: ${p.error} !important; }

        /* ── Logo layers (theme-aware) ── */
        .header-typ-layer  { background-color: ${logoTypColor} !important; }
        .header-user-layer { background-color: ${logoUserColor} !important; }
        .header-dev-layer  { background-color: ${logoUserColor} !important; }
        .header-typ-wrapper {
            filter: drop-shadow(0 0 6px ${logoTypColor}) drop-shadow(0 0 15px rgba(${logoTypRGB}, 0.55)) !important;
        }

        /* Logo glow animations */
        @keyframes header-fade-typ {
            0%   { filter: drop-shadow(0 0 0px rgba(${logoTypRGB}, 0)); }
            100% { filter: drop-shadow(0 0 6px ${logoTypColor}) drop-shadow(0 0 15px rgba(${logoTypRGB}, 0.55)); }
        }
        @keyframes header-fade-user {
            0%   { filter: drop-shadow(0 0 0px rgba(${logoUserRGB}, 0)); }
            100% { filter: drop-shadow(0 0 6px ${logoUserColor}) drop-shadow(0 0 15px rgba(${logoUserRGB}, 0.55)); }
        }
        @keyframes header-fade-dev {
            0%   { filter: drop-shadow(0 0 0px rgba(${logoUserRGB}, 0)); }
            100% { filter: drop-shadow(0 0 6px ${logoUserColor}) drop-shadow(0 0 15px rgba(${logoUserRGB}, 0.55)); }
        }
        @keyframes header-fade-o {
            0%   { filter: drop-shadow(0 0 0px rgba(255, 51, 68, 0)); }
            100% { filter: drop-shadow(0 0 6px #ff3344) drop-shadow(0 0 15px rgba(255, 51, 68, 0.55)); }
        }

        /* ── Caret breath animation ── */
        @keyframes breath {
            0%, 100% { opacity: 1; text-shadow: 0 0 10px rgba(${accentRGB}, 0.6); }
            50%      { opacity: 0.2; text-shadow: 0 0 2px rgba(${accentRGB}, 0.1); }
        }

        /* ── Settings page: opt-btn active state ── */
        .opt-btn.active {
            background: rgba(${accentRGB}, 0.15) !important;
            border-color: rgba(${accentRGB}, 0.35) !important;
            color: ${p.accentPrimary} !important;
            box-shadow: 0 0 8px rgba(${accentRGB}, 0.15) !important;
        }
        .opt-btn.highlighted {
            background: rgba(${accentRGB}, 0.12) !important;
            border-color: rgba(${accentRGB}, 0.45) !important;
            color: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.3) !important;
        }
        .opt-btn.highlighted:hover {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }

        /* ── Settings page: nav pill ── */
        #settings-nav-pill .setting-card.active {
            background: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
        }
        #settings-nav-pill .setting-card.active .card-label {
            background: rgba(${accentRGB}, 0.08) !important;
            box-shadow: inset 0 0 0 1px rgba(${accentRGB}, 0.14) !important;
        }
        #settings-nav-pill .setting-card.active .card-icon {
            color: ${p.accentPrimary} !important;
            filter: drop-shadow(0 0 5px rgba(${accentRGB}, 0.55)) !important;
        }
        #settings-nav-pill .setting-card.active .card-title {
            color: ${p.accentPrimary} !important;
        }

        /* ── Settings page: info popovers ── */
        .info-popover { border-color: rgba(${accentRGB}, 0.2) !important; }

        /* ── Settings page: setting select, toggle ── */
        .setting-select { border-color: rgba(${accentRGB}, 0.25) !important; }
        .setting-select:hover { border-color: rgba(${accentRGB}, 0.5) !important; }
        .toggle-track.on { background: ${p.accentPrimary} !important; border-color: ${p.accentPrimary} !important; box-shadow: 0 0 12px rgba(${accentRGB}, 0.4) !important; }
        .toggle-track.on .toggle-thumb {
            background: ${onPrimary} !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35) !important;
        }

        /* ── Sign-in page side logo layers ── */
        .side-user-layer { background-color: ${logoUserColor} !important; }
        .side-t-layer, .side-y-layer, .side-p-layer { background-color: ${p.textMuted}; }
        .side-o-layer { background-color: ${p.textMuted}; }
        @keyframes color-typ { to { background-color: ${logoTypColor}; } }
        @keyframes color-user { to { background-color: ${logoUserColor}; } }
        @keyframes color-o { to { background-color: #ff3344; } }

        /* ── Sign-in caret ── */
        .signin-caret, [style*="background-color: #95efff"] {
            background-color: ${p.accentPrimary} !important;
        }

        /* ═══════════════════════════════════════════════════════════════
           COMPREHENSIVE THEME OVERRIDES — covers ALL hardcoded colors
           across every page (index, signin, settings, userstats, etc.)
           ═══════════════════════════════════════════════════════════════ */

        /* ── Menu bar active state (all pages) ── */
        .menu-btn.is-active {
            color: ${p.accentPrimary} !important;
            text-shadow: 0 0 15px rgba(${accentRGB}, 0.8) !important;
        }

        /* ── Caret ::after (default underscore) ── */
        #caret::after {
            background-color: ${p.accentPrimary} !important;
            box-shadow: 0 0 6px rgba(${accentRGB}, 0.5) !important;
        }

        /* ── Caret filter glow ── */
        #caret {
            filter: drop-shadow(0 0 8px rgba(${accentRGB}, 0.8)) !important;
        }

        /* ── Tailwind JIT bg-[#00d0ff] overrides ── */
        .bg-\\[\\#00d0ff\\] { background-color: ${p.accentPrimary} !important; }
        .bg-\\[\\#00d0ff\\]\\\/40 { background-color: rgba(${accentRGB}, 0.4) !important; }
        .bg-\\[\\#00d0ff\\]\\\/60 { background-color: rgba(${accentRGB}, 0.6) !important; }
        .bg-\\[\\#00d0ff\\]\\\/20 { background-color: rgba(${accentRGB}, 0.2) !important; }
        .hover\\:bg-\\[\\#00d0ff\\]:hover { background-color: ${p.accentPrimary} !important; }

        /* ── Tailwind blue-* utility remaps (friends page, etc.) ── */
        .bg-blue-500 { background-color: ${p.accentPrimary} !important; }
        .text-blue-400 { color: ${accentLight} !important; }
        .bg-blue-400\\/10 { background-color: rgba(${accentRGB}, 0.1) !important; }
        .border-blue-400\\/20 { border-color: rgba(${accentRGB}, 0.2) !important; }

        /* ── Inline style color overrides ── */
        [style*="background-color: #020016"] { background-color: ${p.bgMain} !important; }
        [style*="background-color:#020016"] { background-color: ${p.bgMain} !important; }
        [style*="color:#00d0ff"] { color: ${p.accentPrimary} !important; }
        [style*="color: #00d0ff"] { color: ${p.accentPrimary} !important; }
        [style*="background:#00d0ff"] { background: ${p.accentPrimary} !important; }
        [style*="background: #00d0ff"] { background: ${p.accentPrimary} !important; }
        [style*="background-color: #00d0ff"] { background-color: ${p.accentPrimary} !important; }
        [style*="background-color:#00d0ff"] { background-color: ${p.accentPrimary} !important; }
        [style*="border"][style*="0,208,255"],
        [style*="border"][style*="0, 208, 255"] { border-color: rgba(${accentRGB}, 0.35) !important; }
        [style*="border-color"][style*="0,208,255"] { border-color: rgba(${accentRGB}, 0.4) !important; }
        [style*="border-color"][style*="0, 208, 255"] { border-color: rgba(${accentRGB}, 0.4) !important; }
        [style*="text-shadow"][style*="0, 208, 255"],
        [style*="text-shadow"][style*="0,208,255"] { text-shadow: 0 0 10px rgba(${accentRGB}, 0.6) !important; }

        /* ── Inline box-shadow overrides (primary-blue + light-cyan variants) ── */
        [style*="box-shadow"][style*="0,208,255"]:not(#config-bar > div),
        [style*="box-shadow"][style*="0, 208, 255"]:not(#config-bar > div),
        [style*="box-shadow"][style*="108, 218, 255"]:not(#config-bar > div),
        [style*="box-shadow"][style*="108,218,255"]:not(#config-bar > div) {
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.35), 0 8px 32px rgba(0,0,0,0.3) !important;
        }

        /* ── Config bar inline style override ── */
        /* (Handled above in the configBarGlow block) */

        /* ── Progress bar glow ── */
        #word-progress-bar { box-shadow: 0 0 10px rgba(${accentRGB}, 0.8) !important; }

        /* ── Stats hero card ── */
        #stats-hero-card { border-color: rgba(${accentRGB}, 0.1) !important; }

        /* ── Pill indicator (signin + general) ── */
        .tab-pill-indicator {
            background: rgba(${accentRGB}, 0.18) !important;
            border-color: rgba(${accentRGB}, 0.5) !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.25) !important;
        }

        /* ── caretBreath animation (signin) ── */
        @keyframes caretBreath {
            0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(${accentRGB}, 1); }
            50% { opacity: 0.3; box-shadow: 0 0 4px rgba(${accentRGB}, 0.2); }
        }

        /* ── Sign-in field styles ── */
        .field-wrap input:focus { border-bottom-color: rgba(${accentRGB}, 0.5) !important; }
        .field-wrap input:focus ~ label,
        .field-wrap input:not(:placeholder-shown) ~ label,
        .field-wrap input:-webkit-autofill ~ label,
        .field-wrap input:autofill ~ label { color: ${p.accentPrimary} !important; }
        .field-wrap::after { background: ${p.accentPrimary} !important; box-shadow: 0 0 8px rgba(${accentRGB}, 0.6) !important; }
        .field-wrap input:-webkit-autofill,
        .field-wrap input:-webkit-autofill:hover,
        .field-wrap input:-webkit-autofill:focus,
        .field-wrap input:-webkit-autofill:active,
        .field-wrap input:autofill {
            -webkit-text-fill-color: ${p.textPrimary} !important;
            caret-color: ${p.textPrimary};
            color: ${p.textPrimary} !important;
            -webkit-box-shadow: 0 0 0 1000px ${p.bgMain} inset !important;
            box-shadow: 0 0 0 1000px ${p.bgMain} inset !important;
        }

        /* ── Sign-in primary button ── */
        .btn-primary { border-color: rgba(${accentRGB}, 0.5) !important; }
        .btn-primary::before { background: linear-gradient(135deg, rgba(${accentRGB}, 0.08) 0%, rgba(${accentRGB}, 0.18) 100%) !important; }
        .btn-primary:hover {
            border-color: rgba(${accentRGB}, 0.9) !important;
            box-shadow: 0 0 20px rgba(${accentRGB}, 0.25), 0 0 40px rgba(${accentRGB}, 0.1) !important;
        }

        /* ── Sign-in accent links ── */
        .white-link.accent { color: ${p.accentPrimary} !important; }
        .white-link.accent:hover { text-shadow: 0 0 14px rgba(${accentRGB}, 0.8) !important; }

        /* ── Sign-in side underscore (color/glow only — never override caret left) ── */
        .side-underscore {
            background-color: ${logoTypColor} !important;
            box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7) !important;
        }
        @keyframes side-underscore-breath {
            0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); }
            50% { opacity: 0.3; box-shadow: 0 0 4px rgba(${logoTypRGB}, 0.2); }
        }

        /* ── SSO callback page ── */
        .sso-callback-title { color: ${p.textPrimary} !important; }
        .sso-callback-msg, .sso-continue-form label { color: ${p.textMuted} !important; }
        .sso-callback-error { color: ${p.error} !important; }
        .sso-continue-form input {
            color: ${p.textPrimary} !important;
            border-color: rgba(${accentRGB}, 0.22) !important;
        }
        .sso-continue-form input:focus {
            border-color: rgba(${accentRGB}, 0.55) !important;
            box-shadow: 0 0 0 1px rgba(${accentRGB}, 0.25) !important;
        }
        .sso-continue-form button {
            border-color: rgba(${accentRGB}, 0.45) !important;
            background: rgba(${accentRGB}, 0.15) !important;
            color: ${p.accentPrimary} !important;
        }

        /* ── Google OAuth username chooser ── */
        .oauth-choice-btn {
            color: ${p.textPrimary} !important;
            border-color: rgba(${accentRGB}, 0.22) !important;
        }
        .oauth-choice-btn:hover {
            border-color: rgba(${accentRGB}, 0.45) !important;
            background: rgba(${accentRGB}, 0.08) !important;
        }
        .oauth-choice-btn.is-selected {
            border-color: rgba(${accentRGB}, 0.65) !important;
            background: rgba(${accentRGB}, 0.14) !important;
            box-shadow: 0 0 0 1px rgba(${accentRGB}, 0.2) !important;
        }
        .oauth-choice-btn .oauth-choice-sub { color: ${p.textMuted} !important; }

        /* ── Sign-in side logo glow animation ── */
        @keyframes glow-typ {
            to { filter: drop-shadow(0 0 6px ${logoTypColor}) drop-shadow(0 0 15px rgba(${logoTypRGB}, 0.55)); }
        }

        /* ── Userstats page ── */
        .neon-border-glow { box-shadow: 0 0 15px rgba(${accentRGB}, 0.1) !important; }
        .cyan-glow-text { text-shadow: 0 0 8px rgba(${accentRGB}, 0.5) !important; }
        @keyframes neonPulse {
            0%, 100% { border-color: rgba(${accentRGB}, 0.35); }
            50% { border-color: rgba(${accentRGB}, 0.7); box-shadow: inset 0 0 30px rgba(${accentRGB}, 0.1); }
        }
        .featured-hover:hover {
            box-shadow: 0 0 0 1px rgba(${accentRGB}, 0.32), 0 0 38px rgba(${accentRGB}, 0.13) !important;
            border-color: rgba(${accentRGB}, 0.32) !important;
        }
        .file-upload-zone {
            border-color: rgba(${accentRGB}, 0.5) !important;
            background: rgba(${accentRGB}, 0.04) !important;
            box-shadow: inset 0 0 20px rgba(${accentRGB}, 0.06) !important;
        }

        /* ── Settings page accent colors ── */
        .sidebar-tab.active .tab-icon { color: ${p.accentPrimary} !important; }
        .sidebar-tab:hover .tab-icon { color: ${p.accentPrimary} !important; }
        .sub-setting-label { color: ${p.accentPrimary} !important; }
        .setting-value-display { color: ${p.accentPrimary} !important; }
        .card-tab.active { color: ${p.accentPrimary} !important; }
        .sub-setting-arrow { color: ${p.accentPrimary} !important; }
        .sidebar-search-input:focus { color: ${p.accentPrimary} !important; }

        /* ── Settings page sub-setting-card — no outer box around option rows ── */
        .sub-setting-card,
        .sub-setting-card.glass-card {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
        }
        .sub-card-header {
            border-radius: 9999px !important;
        }

        /* ── Settings range slider ── */
        input[type="range"]::-webkit-slider-thumb {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.8), 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }
        input[type="range"]::-moz-range-thumb {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.8), 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }
        input[type="range"] {
            background-image: linear-gradient(${p.accentPrimary}, ${p.accentPrimary}), linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)) !important;
        }

        /* ── Settings select — no CSS dropdown arrow (buttons have their own chevron) ── */
        .setting-select {
            background-image: none !important;
        }

        /* ── SVG graph colors ── */
        [stroke="#00d0ff"] { stroke: ${p.accentPrimary} !important; }
        [fill="#00d0ff"] { fill: ${p.accentPrimary} !important; }
        [stop-color="#00d0ff"] { stop-color: ${p.accentPrimary} !important; }
        [stroke="#6cdaff"] { stroke: ${accentLight} !important; }
        [fill="#6cdaff"] { fill: ${accentLight} !important; }
        [stop-color="#6cdaff"] { stop-color: ${accentLight} !important; }

        /* ── Leaderboards panel glow ── */
        .leaderboard-panel {
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.35), 0 8px 32px rgba(0,0,0,0.3) !important;
            border-color: rgba(${accentRGB}, 0.4) !important;
        }

        /* ── Room / lobby accent surfaces ── */
        .player-pill.me {
            background: rgba(${accentRGB}, 0.08) !important;
            border-color: rgba(${accentRGB}, 0.4) !important;
            box-shadow: 0 0 20px rgba(${accentRGB}, 0.1) !important;
        }
        .progress-fill {
            background: linear-gradient(90deg, ${p.accentPrimary}, ${accentLight}) !important;
        }
        .player-pill.me .progress-fill {
            box-shadow: 0 0 8px rgba(${accentRGB}, 0.35) !important;
        }
        .player-node.is-ready .player-avatar-ring .player-level-avatar__photo {
            border-color: rgba(${accentRGB}, 0.85) !important;
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.55), 0 0 28px rgba(${accentRGB}, 0.2) !important;
        }
        .player-node.is-ready .player-ready-dot {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 6px rgba(${accentRGB}, 0.8) !important;
        }
        .neon-glow-primary { box-shadow: 0 0 15px rgba(${accentRGB}, 0.2) !important; }
        .neon-glow-primary-strong { box-shadow: 0 0 25px rgba(${accentRGB}, 0.4) !important; }
        .winner-glow {
            box-shadow: 0 0 25px rgba(${accentRGB}, 0.12), 0 4px 30px rgba(0, 0, 0, 0.15) !important;
            border-color: rgba(${accentRGB}, 0.15) !important;
        }

        /* ── Settings page leftover hardcoded accents ── */
        #info-portal .info-title { color: ${p.accentPrimary} !important; }
        .setting-info-btn:hover {
            background: rgba(${accentRGB}, 0.12) !important;
            border-color: rgba(${accentRGB}, 0.35) !important;
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.2) !important;
        }
        .setting-info-btn .material-symbols-outlined { color: ${p.accentPrimary} !important; }
        .setting-select:focus {
            border-color: rgba(${accentRGB}, 0.4) !important;
            box-shadow: 0 0 0 2px rgba(${accentRGB}, 0.1) !important;
        }
        .search-input:focus {
            border-color: rgba(${accentRGB}, 0.35) !important;
            box-shadow: 0 0 0 2px rgba(${accentRGB}, 0.08) !important;
        }

        /* ── Settings page: setting cards, quick buttons, sliders ── */
        #settings-panel .setting-card.active {
            border-color: rgba(${accentRGB}, 0.3) !important;
            box-shadow: 0 0 15px rgba(${accentRGB}, 0.08), inset 0 0 0 1px rgba(${accentRGB}, 0.05) !important;
            background: var(--theme-menu-bg) !important;
            background-image: none !important;
        }
        .opt-btn,
        .setting-select,
        .sub-card-header {
            border-radius: var(--theme-box-radius, 1.375rem) !important;
        }
        .quick-btn:hover {
            background: rgba(${accentRGB}, 0.1) !important;
            border-color: rgba(${accentRGB}, 0.3) !important;
            color: ${p.accentPrimary} !important;
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.15) !important;
        }
        input[type="range"].custom-slider {
            background-image: linear-gradient(${p.accentPrimary}, ${p.accentPrimary}), linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)) !important;
        }
        input[type="range"].custom-slider::-webkit-slider-thumb {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.8), 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }
        input[type="range"].custom-slider::-moz-range-thumb {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.8), 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }
        input[type="range"]::-webkit-slider-thumb {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.8), 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }
        input[type="range"]::-moz-range-thumb {
            background: ${p.accentPrimary} !important;
            box-shadow: 0 0 10px rgba(${accentRGB}, 0.8), 0 0 15px rgba(${accentRGB}, 0.6) !important;
        }
        input[type="range"] {
            background-image: linear-gradient(${p.accentPrimary}, ${p.accentPrimary}), linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.1)) !important;
        }

        /* ── Find-match / dual accent widget stroke catch-alls ── */
        [stroke="rgba(0,208,255,0.18)"] { stroke: rgba(${accentRGB}, 0.18) !important; }
        [stroke="rgba(0, 208, 255, 0.18)"] { stroke: rgba(${accentRGB}, 0.18) !important; }

        /* ── Glow intensity: soft backdrop blobs (avatar/podium washes) ── */
        [data-screenshot-glow] {
            opacity: var(--glow-intensity, 1) !important;
            transition: opacity 0.12s ease;
        }

        /* Common white glow utilities (not remapped by accent overrides) */
        .drop-shadow-\\[0_0_8px_rgba\\(255\\,255\\,255\\,0\\.6\\)\\] {
            filter: drop-shadow(0 0 8px rgba(255, 255, 255, calc(0.6 * var(--glow-intensity, 1)))) !important;
        }
        .hover\\:drop-shadow-\\[0_0_8px_rgba\\(255\\,255\\,255\\,0\\.8\\)\\]:hover {
            filter: drop-shadow(0 0 8px rgba(255, 255, 255, calc(0.8 * var(--glow-intensity, 1)))) !important;
        }
        .\\[text-shadow\\:0_0_8px_rgba\\(255\\,255\\,255\\,0\\.6\\)\\] {
            text-shadow: 0 0 8px rgba(255, 255, 255, calc(0.6 * var(--glow-intensity, 1))) !important;
        }
    `;

    // Bind each authored glow alpha to --glow-intensity (100% = unchanged look)
    css = embedGlowIntensityInCss(css);

    let tag = document.getElementById('usertypo-theme-css');
    if (!tag) {
        tag = document.createElement('style');
        tag.id = 'usertypo-theme-css';
    }
    // Always append to end of head to override inline page styles + boot theme
    if (document.head) document.head.appendChild(tag);

    tag.textContent = css;

    applyGlowIntensityVar(settings);

    try {
        document.documentElement.setAttribute('data-theme-light', themeIsLight ? '1' : '0');
        document.documentElement.classList.toggle('theme-light', !!themeIsLight);
    } catch (e) { /* ignore */ }



    // Keep boot-theme in sync with CSS variables only (no hardcoded bg hex),
    // so live theme switches update backgrounds without a full refresh.
    const bootTag = document.getElementById('usertypo-boot-theme');
    if (bootTag) {
        bootTag.textContent = [
            ':root{',
            `--theme-primary:${p.accentPrimary};`,
            `--theme-primary-rgb:${accentRGB};`,
            `--theme-primary-hover:${p.accentHover};`,
            `--theme-bg:${p.bgMain};`,
            `--theme-bg-rgb:${bgMainRGB};`,
            `--theme-bg-secondary:${p.bgSecondary};`,
            `--theme-bg-secondary-rgb:${bgSecRGB};`,
            `--theme-menu-bg:rgba(${bgSecRGB}, 0.4);`,
            `--theme-box-radius:1.375rem;`,
            `--settings-box-radius:1.375rem;`,
            `--theme-text:${p.textPrimary};`,
            `--theme-text-muted:${p.textMuted};`,
            `--theme-error:${p.error};`,
            `--theme-error-rgb:${errorRGB};`,
            `--theme-on-primary:${onPrimary};`,
            `--theme-fg-strong:${fgStrong};`,
            `--theme-ring-track:${ringTrack};`,
            `--theme-is-light:${themeIsLight ? '1' : '0'};`,
            `--glow-intensity:${glowFactor};`,
            '}',
            'html,body{background-color:var(--theme-bg) !important;}',
            '#app-backdrop,#spa-content,#spa-boot-overlay{background-color:var(--theme-bg) !important;}',
            '.text-primary{color:var(--theme-primary) !important;}',
            '.bg-primary{background-color:var(--theme-primary) !important;}',
            '.bg-background,.bg-background-dark{background-color:var(--theme-bg) !important;}',
            '.bg-surface{background-color:var(--theme-bg-secondary) !important;}',
            '#caret::after,#spa-boot-caret::after{background-color:var(--theme-primary) !important;}'
        ].join('');
    }

    // Drive root-level vars + clear any stale inline bg so switches apply smoothly
    try {
        publishThemeCssVars(p, {
            accentRGB, bgMainRGB, bgSecRGB, errorRGB,
            onPrimary, fgStrong, ringTrack, themeIsLight,
            glowFactor, glowPct,
        });
        const root = document.documentElement;
        root.style.backgroundColor = p.bgMain;
        if (document.body) document.body.style.backgroundColor = p.bgMain;
        const backdrop = document.getElementById('app-backdrop');
        if (backdrop) backdrop.style.backgroundColor = p.bgMain;
        const spaContent = document.getElementById('spa-content');
        if (spaContent) spaContent.style.backgroundColor = p.bgMain;
    } catch { /* ignore */ }

    // Expose live accent for page scripts (copy flash, widgets, etc.)
    try {
        window.usertypo_themeAccent = p.accentPrimary;
        window.usertypo_themeAccentRGB = accentRGB;
        window.usertypo_themeIsLight = themeIsLight;
    } catch { /* ignore */ }

    // Compact theme boot cookie for first-paint (read by js/boot-theme.js)
    try {
        if (window.usertypoCookies && typeof window.usertypoCookies.writeThemeBoot === 'function') {
            window.usertypoCookies.writeThemeBoot({
                name: themeName,
                bgMain: p.bgMain,
                bgSecondary: p.bgSecondary,
                textPrimary: p.textPrimary,
                textMuted: p.textMuted,
                accentPrimary: p.accentPrimary,
                accentHover: p.accentHover,
                error: p.error,
                isLight: themeIsLight,
            });
        }
    } catch { /* ignore */ }

    // Tab favicon: blah template recolored to theme bg + accent (circular)
    try {
        if (typeof window.usertypoUpdateFavicon === 'function') {
            window.usertypoUpdateFavicon(p.bgMain, p.accentPrimary);
        }
    } catch { /* ignore */ }
}


// ─────────────────────────────────────────────────────────────────────────────
//  2. BINDING  —  data-setting attributes on HTML controls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the value of an opt-btn.
 * Icon-only buttons (caret style) use the title attribute.
 * Text buttons use textContent.
 */
function resolveOptValue(btn) {
    // Collapse internal whitespace/newlines from multi-line HTML button text
    const text = btn.textContent.replace(/\s+/g, ' ').trim();
    const path = getSettingPath(btn);
    let val = text || (btn.getAttribute('title') || '');
    if (path && (path.startsWith('cursor.') || path === 'soundscape.errorSounds')) return val.toLowerCase();
    return val;
}

/**
 * Find the data-setting path for a control element.
 * For opt-btns: the parent [data-setting] container.
 * For toggles: the toggle-track itself has [data-setting].
 */
function getSettingPath(el) {
    // Direct check: toggle tracks have data-setting on themselves
    if (el.dataset.setting) return el.dataset.setting;
    // Walk up to find the nearest container with data-setting
    const container = el.closest('[data-setting]');
    return container ? container.dataset.setting : null;
}


// ─────────────────────────────────────────────────────────────────────────────
//  3. GLOBAL APPLICATION — applyCursorSettings()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caret smoothness → transition duration.
 *
 *   off    → 0ms   (instant jump, no animation)
 *   slow   → 300ms (relaxed, fluid glide)
 *   medium → 200ms (the current default feel)
 *   fast   → 80ms  (snappy, near-instant)
 */
const SMOOTHNESS_DURATION = {
    off: '0ms',
    slow: '300ms',
    medium: '200ms',
    fast: '80ms',
};

/**
 * Build the CSS for a given caret style + smoothness.
 *
 *   line       → thin 2.5px vertical bar on the left edge
 *   block      → full-width semi-transparent highlight
 *   underscore → horizontal bar under the character
 *   outline    → hollow box around the character
 */
function buildCaretCSS(style, smoothness, accentHex, accentRGB) {
    accentHex = accentHex || '#ffffff';
    accentRGB = accentRGB || '255, 255, 255';
    const dur = SMOOTHNESS_DURATION[smoothness] || SMOOTHNESS_DURATION.medium;
    const ease = 'cubic-bezier(0.2, 0, 0.2, 1)';
    const transition = `transform ${dur} ${ease}, width ${dur} ${ease}, opacity 0.5s ease-in-out`;
    // Boot caret: same look, but transform-only transition (no width morph / slide)
    const bootTransition = `transform ${dur} ${ease}`;

    let css = '';
    let boot = '';

    switch (style) {
        case 'line':
            css = `
                #caret {
                    transition: ${transition} !important;
                    width: 2.5px !important;
                    background-color: ${accentHex};
                    border: none !important;
                    border-radius: 2px;
                    box-shadow: 0 0 8px rgba(${accentRGB},0.6);
                }
                #caret::after { display: none !important; }
            `;
            boot = `
                #spa-boot-caret {
                    transition: ${bootTransition} !important;
                    width: 2.5px !important;
                    background-color: ${accentHex};
                    border: none !important;
                    border-radius: 2px;
                    box-shadow: 0 0 8px rgba(${accentRGB},0.6);
                }
                #spa-boot-caret::after { display: none !important; }
            `;
            break;

        case 'block':
            css = `
                #caret {
                    transition: ${transition} !important;
                    background-color: rgba(${accentRGB},0.25);
                    border: none !important;
                    border-radius: 2px;
                    box-shadow: none;
                }
                #caret::after { display: none !important; }
            `;
            boot = `
                #spa-boot-caret {
                    transition: ${bootTransition} !important;
                    background-color: rgba(${accentRGB},0.25);
                    border: none !important;
                    border-radius: 2px;
                    box-shadow: none;
                }
                #spa-boot-caret::after { display: none !important; }
            `;
            break;

        case 'underscore':
            css = `
                #caret {
                    transition: ${transition} !important;
                    background-color: transparent;
                    border: none !important;
                    box-shadow: none;
                }
                #caret::after {
                    content: '' !important;
                    display: block !important;
                    position: absolute;
                    bottom: -2.5px;
                    left: 0;
                    right: 0;
                    height: 2.5px;
                    background-color: ${accentHex};
                    border-radius: 9999px;
                    box-shadow: 0 0 6px rgba(${accentRGB},0.5);
                }
            `;
            boot = `
                #spa-boot-caret {
                    transition: ${bootTransition} !important;
                    background-color: transparent;
                    border: none !important;
                    box-shadow: none;
                }
                #spa-boot-caret::after {
                    content: '' !important;
                    display: block !important;
                    position: absolute;
                    bottom: -2.5px;
                    left: 0;
                    right: 0;
                    height: 2.5px;
                    background-color: ${accentHex};
                    border-radius: 9999px;
                    box-shadow: 0 0 6px rgba(${accentRGB},0.5);
                }
            `;
            break;

        case 'outline':
            css = `
                #caret {
                    transition: ${transition} !important;
                    background-color: transparent;
                    border: 2px solid rgba(${accentRGB},0.6) !important;
                    border-radius: 3px;
                    box-shadow: 0 0 6px rgba(${accentRGB},0.25);
                }
                #caret::after { display: none !important; }
            `;
            boot = `
                #spa-boot-caret {
                    transition: ${bootTransition} !important;
                    background-color: transparent;
                    border: 2px solid rgba(${accentRGB},0.6) !important;
                    border-radius: 3px;
                    box-shadow: 0 0 6px rgba(${accentRGB},0.25);
                }
                #spa-boot-caret::after { display: none !important; }
            `;
            break;
    }

    return css + boot;
}

/**
 * Pace caret styles — ghost caret matching live-stats white at 50% opacity.
 * Movement smoothness mirrors the main caret (caretSmoothness setting).
 */
function buildPaceCaretCSS(style, smoothness) {
    style = (style || 'underscore').toLowerCase();
    const dur = SMOOTHNESS_DURATION[smoothness] || SMOOTHNESS_DURATION.medium;
    const ease = 'cubic-bezier(0.2, 0, 0.2, 1)';
    const transition = `transform ${dur} ${ease}, width ${dur} ${ease}, opacity 0.5s ease-in-out`;
    const liveWhite = '#ffffff';
    const liveWhiteRGB = '255, 255, 255';

    let css = `
        #pace-caret {
            transition: ${transition} !important;
            opacity: 0.5 !important;
            filter: drop-shadow(0 0 8px rgba(${liveWhiteRGB}, 0.3));
        }
    `;

    switch (style) {
        case 'line':
            css += `
                #pace-caret {
                    width: 2.5px !important;
                    background-color: ${liveWhite};
                    border: none !important;
                    border-radius: 2px;
                    box-shadow: none;
                }
                #pace-caret::after { display: none !important; }
            `;
            break;

        case 'block':
            css += `
                #pace-caret {
                    background-color: rgba(${liveWhiteRGB}, 0.25);
                    border: none !important;
                    border-radius: 2px;
                    box-shadow: none;
                }
                #pace-caret::after { display: none !important; }
            `;
            break;

        case 'underscore':
            css += `
                #pace-caret {
                    background-color: transparent;
                    border: none !important;
                    box-shadow: none;
                }
                #pace-caret::after {
                    content: '' !important;
                    display: block !important;
                    position: absolute;
                    bottom: -2.5px;
                    left: 0;
                    right: 0;
                    height: 2.5px;
                    background-color: ${liveWhite};
                    border-radius: 9999px;
                    box-shadow: 0 0 6px rgba(${liveWhiteRGB}, 0.25);
                }
            `;
            break;

        case 'outline':
            css += `
                #pace-caret {
                    background-color: transparent;
                    border: 2px solid rgba(${liveWhiteRGB}, 0.6) !important;
                    border-radius: 3px;
                    box-shadow: 0 0 6px rgba(${liveWhiteRGB}, 0.15);
                }
                #pace-caret::after { display: none !important; }
            `;
            break;

        default:
            css += `
                #pace-caret {
                    background-color: transparent;
                    border: none !important;
                    box-shadow: none;
                }
                #pace-caret::after {
                    content: '' !important;
                    display: block !important;
                    position: absolute;
                    bottom: -2.5px;
                    left: 0;
                    right: 0;
                    height: 2.5px;
                    background-color: ${liveWhite};
                    border-radius: 9999px;
                    box-shadow: 0 0 6px rgba(${liveWhiteRGB}, 0.25);
                }
            `;
            break;
    }

    return css;
}

function buildLayoutCSS(smoothLineScroll, tapeMode, caretSmoothness) {
    let css = '';
    const ease = 'cubic-bezier(0.2, 0, 0.2, 1)';
    const smoothnessDur = SMOOTHNESS_DURATION[caretSmoothness] || SMOOTHNESS_DURATION.medium;

    // Scroll transition speed (same for normal + tape mode — matches index.html feel)
    if (smoothLineScroll) {
        css += `
            #text-container,
            #room-text-container {
                transition: filter 0.3s ease-in-out,
                            opacity 0.5s ease-in-out,
                            transform 0.25s ${ease} !important;
            }
        `;
    } else {
        css += `
            #text-container,
            #room-text-container {
                transition: filter 0.3s ease-in-out,
                            opacity 0.5s ease-in-out,
                            transform 0s !important;
            }
        `;
    }

    // Tape mode layout
    if (tapeMode === 'word' || tapeMode === 'letter') {
        css += `
            body[data-tape-mode="word"] #text-container,
            body[data-tape-mode="letter"] #text-container,
            body[data-tape-mode="word"] #room-text-container,
            body[data-tape-mode="letter"] #room-text-container {
                flex-wrap: nowrap !important;
                margin: 0 !important;
                padding: 0 !important;
                width: max-content !important;
            }
            body[data-tape-mode="word"] #typing-area,
            body[data-tape-mode="letter"] #typing-area,
            body[data-tape-mode="word"] #room-typing-area,
            body[data-tape-mode="letter"] #room-typing-area {
                white-space: nowrap !important;
                -webkit-mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
                mask-image: linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%);
            }
        `;

        // Tape scroll follows caret smoothness. Caret transform uses the same
        // duration/easing so both stay locked (no jitter) while still feeling smooth.
        css += `
            body[data-tape-mode="${tapeMode}"] #text-container,
            body[data-tape-mode="${tapeMode}"] #room-text-container {
                transition: filter 0.3s ease-in-out,
                            opacity 0.5s ease-in-out,
                            transform ${smoothnessDur} ${ease} !important;
            }
            body[data-tape-mode="${tapeMode}"] #caret,
            body[data-tape-mode="${tapeMode}"] #pace-caret,
            body[data-tape-mode="${tapeMode}"] #bot-caret {
                transition: transform ${smoothnessDur} ${ease},
                            width 0s,
                            opacity 0.5s ease-in-out !important;
            }
        `;
    }

    return css;
}


function isRoomPage() {
    return !!document.getElementById('room-typing-area');
}

function isDualPage() {
    return !!document.getElementById('bot-caret');
}

function getEffectiveTapeMode(settings) {
    const cursor = settings?.cursor || {};
    return String(cursor.tapeMode || 'off').toLowerCase();
}

/**
 * The main applier. Call on ANY page to push saved settings into live CSS.
 */
function applyCursorSettings(settings) {
    if (!settings) settings = loadSettings();

    const effectiveTapeMode = getEffectiveTapeMode(settings);

    // ── Inject / update the dynamic <style> tag ──
    let styleEl = document.getElementById('usertypo-cursor-settings-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'usertypo-cursor-settings-css';
    }
    if (document.head) document.head.appendChild(styleEl);

    const _themeName = settings.lookFeel?.colorTheme || getPreferredDefaultTheme();
    const _palette = resolveThemePalette(settings, _themeName);
    const _caretAccent = _palette.accentPrimary;
    const _caretRGB = _hexToRGB(_caretAccent);
    styleEl.textContent = buildCaretCSS(settings.cursor.caretStyle, settings.cursor.caretSmoothness, _caretAccent, _caretRGB)
        + buildPaceCaretCSS(settings.cursor.paceCaretStyle, settings.cursor.caretSmoothness)
        + buildLayoutCSS(settings.cursor.smoothLineScroll, effectiveTapeMode, settings.cursor.caretSmoothness);

    // ── Data attributes on <body> ──
    if (document.body) {
        document.body.setAttribute('data-caret-style', settings.cursor.caretStyle);
        document.body.setAttribute('data-caret-smoothness', settings.cursor.caretSmoothness);
        document.body.setAttribute('data-adaptive-smoothness', String(settings.cursor.adaptiveSmoothness));
        document.body.setAttribute('data-smooth-line-scroll', String(settings.cursor.smoothLineScroll));
        document.body.setAttribute('data-tape-mode', effectiveTapeMode);
        document.body.setAttribute('data-pace-caret-mode', settings.cursor.paceCaretMode);
        document.body.setAttribute('data-pace-caret-style', settings.cursor.paceCaretStyle);
    }

    // ── Adaptive smoothness hook ──
    setupAdaptiveSmoothness(settings.cursor.adaptiveSmoothness);

    if (!settings.cursor.adaptiveSmoothness) {
        document.getElementById('caret')?.style.removeProperty('transition');
        document.getElementById('spa-boot-caret')?.style.removeProperty('transition');
        document.getElementById('pace-caret')?.style.removeProperty('transition');
        document.getElementById('text-container')?.style.removeProperty('transition');
        document.getElementById('room-text-container')?.style.removeProperty('transition');
    }

    try {
        window.dispatchEvent(new CustomEvent('usertypo:theme-applied', {
            detail: { theme: themeName, accentPrimary: p.accentPrimary },
        }));
    } catch (e) { /* ignore */ }
}


/**
 * Apply soundscape settings: push to body data attributes & update live state.
 * The audio manager in index.html reads from window.usertypo_settings at play
 * time, so keeping that object current is all we need.
 */
function applySoundscapeSettings(settings) {
    if (!settings) settings = loadSettings();

    if (document.body) {
        document.body.setAttribute('data-click-sounds', String(!!settings.soundscape.clickSounds));
        document.body.setAttribute('data-error-sounds', String(!!settings.soundscape.errorSounds));
        document.body.setAttribute('data-master-volume', String(settings.soundscape.masterVolume));
        document.body.setAttribute('data-sound-muted', String(!!settings.soundscape.muted));
        document.body.setAttribute('data-sound-pack', settings.soundscape.soundPack);
    }

    // Pre-load the chosen sound pack if the audio manager is available
    if (settings.soundscape.clickSounds && !settings.soundscape.muted && typeof window.loadSoundPack === 'function') {
        window.loadSoundPack(settings.soundscape.soundPack);
    }

    updateFooterMuteUI(settings);
}

/**
 * Resolve a language file id to a human-readable display name.
 */
function getLanguageDisplayName(langFile) {
    const file = langFile || 'english';
    if (typeof getSettingsPageLanguages === 'function') {
        const found = getSettingsPageLanguages().find(l => l.file === file);
        if (found) return found.name;
    }
    if (typeof ALL_LANGUAGES !== 'undefined' && Array.isArray(ALL_LANGUAGES)) {
        const found = ALL_LANGUAGES.find(l => l.file === file);
        if (found) return found.name;
    }
    return file
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/**
 * Sync footer theme/language pills (and mute icon on index) with saved settings.
 */
function applyFooterSettings(settings) {
    if (!settings) settings = loadSettings();

    const themeName = settings.lookFeel?.colorTheme || getPreferredDefaultTheme();
    const themeLabel = getThemeDisplayName(themeName, settings);
    const langFile = settings.languageContent?.testLanguage || 'english';
    const langName = getLanguageDisplayName(langFile);

    document.querySelectorAll('[data-footer-picker]').forEach(el => {
        el.textContent = `${themeLabel}, ${langName}`;
    });

    updateFooterMuteUI(settings);
}

function updateFooterMuteUI(settings) {
    if (!settings) settings = loadSettings();
    const clickSoundsOn = !!settings.soundscape?.clickSounds;
    const icon = clickSoundsOn ? 'volume_up' : 'volume_off';
    const label = clickSoundsOn ? 'Mute sounds' : 'Unmute sounds';

    document.querySelectorAll('.footer-mute-btn').forEach(btn => {
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });
    document.querySelectorAll('[data-footer-mute-icon]').forEach(el => {
        el.textContent = icon;
    });
    document.querySelectorAll('[data-setting="soundscape.clickSounds"]').forEach(track => {
        track.classList.toggle('on', clickSoundsOn);
    });
}

/**
 * Toggle click sounds from the footer volume icon (synced with Click Sounds setting only).
 */
function toggleFooterMute() {
    const settings = loadSettings();
    if (!settings.soundscape) settings.soundscape = structuredClone(DEFAULTS.soundscape);
    settings.soundscape.clickSounds = !settings.soundscape.clickSounds;
    saveSettings(settings);
    applySoundscapeSettings(settings);
}

/**
 * Select a color theme from the footer picker (or elsewhere) and sync UI.
 */
function selectColorTheme(themeName) {
    const settings = loadSettings();
    if (!settings.lookFeel) settings.lookFeel = structuredClone(DEFAULTS.lookFeel);

    if (isCustomThemeName(themeName) && themeName.startsWith('custom:')) {
        const idx = parseInt(themeName.slice(7), 10);
        const preset = settings.lookFeel.customPresets?.[idx];
        if (preset) {
            const mode = isLightModeValue(preset.mode) ? 'Light' : 'Dark';
            const bgColor = normalizeHexColor(
                preset.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
                CUSTOM_THEME_DEFAULT.bgColor
            );
            settings.lookFeel.customTheme = {
                mode,
                mainColor: normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
                secondaryColor: normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
                bgColor,
                bgSpectrumPos: resolveSpectrumPos(mode, bgColor, preset.bgSpectrumPos),
            };
        }
    }

    setByPath(settings, 'lookFeel.colorTheme', themeName);
    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
    applyThemeSettings(settings);
}


/**
 * Apply test-rules settings: push to body data attributes.
 * index.html reads these at runtime via window.usertypo_settings.
 */
function applyTestRulesSettings(settings) {
    if (!settings) settings = loadSettings();
    if (!document.body) return;

    const tr = settings.testRules;
    document.body.setAttribute('data-difficulty', tr.difficulty);
    document.body.setAttribute('data-stop-on-error', tr.stopOnError);
    document.body.setAttribute('data-confidence-mode', tr.confidenceMode);
    document.body.setAttribute('data-freedom-mode', String(!!tr.freedomMode));
    document.body.setAttribute('data-indicate-typos', tr.indicateTypos);
    document.body.setAttribute('data-lazy-mode', String(!!tr.lazyMode));
    document.body.setAttribute('data-strict-space', String(!!tr.strictSpace));
    document.body.setAttribute('data-required-correct-end', String(!!tr.requiredCorrectEnd));
    document.body.setAttribute('data-capslock-warning', String(!!tr.capslockWarning));
    document.body.setAttribute('data-opposite-shift', String(!!tr.oppositeShift));
}

function getKeymapRenderArgs() {
    if (typeof window.usertypo_getKeymapRenderArgs === 'function') {
        return window.usertypo_getKeymapRenderArgs();
    }
    return { useNumbers: true, usePunctuation: true };
}

function getTestKeymapContainers() {
    const containers = [];
    const room = document.getElementById('room-keymap-container');
    if (room) containers.push(room);
    const index = document.getElementById('dynamic-keymap-container');
    if (index && document.getElementById('typing-area')) containers.push(index);
    return containers;
}

function isSettingsKeymapPreviewPage() {
    var container = document.getElementById('dynamic-keymap-container');
    if (!container) return false;
    // User Stats Hardware Hotspots reuses the keymap markup — do not treat it as settings.
    if (container.closest('#hardware-hotspots-card')) return false;
    return !document.getElementById('typing-area')
        && !document.getElementById('room-keymap-container');
}

/**
 * Show/hide and render the on-screen keymap for test pages and settings preview.
 * When the keymap is visible on the typing page, unlock page scroll so the
 * footer remains reachable.
 */
function syncTypingScrollForKeymap(keymapOn) {
    const onTypingPage = !!document.getElementById('typing-area')
        && !!document.getElementById('test-view')
        && !document.getElementById('test-view')?.classList.contains('hidden');
    const onStats = !!document.getElementById('stats-view')
        && !document.getElementById('stats-view')?.classList.contains('hidden')
        && document.getElementById('stats-view')?.style.display !== 'none';

    if (!onTypingPage || onStats) return;

    if (keymapOn) {
        if (typeof window.usertypo_unlockStatsScroll === 'function') {
            window.usertypo_unlockStatsScroll();
        }
        document.body?.classList.add('keymap-scrollable');
    } else {
        document.body?.classList.remove('keymap-scrollable');
        if (typeof window.usertypo_lockTypingScroll === 'function') {
            window.usertypo_lockTypingScroll();
        }
    }
}

function applyKeymapDisplay(settings) {
    if (!settings) settings = loadSettings();
    if (typeof window.syncKeymapLayoutForLanguage === 'function') {
        window.syncKeymapLayoutForLanguage(settings);
    }
    const kl = settings.keyboardLayout || DEFAULTS.keyboardLayout;
    const isOn = kl.keymapMode && kl.keymapMode !== 'Off';
    const langFile = settings.languageContent?.testLanguage
        || (typeof currentLanguageFile !== 'undefined' ? currentLanguageFile : 'english');

    const testContainers = getTestKeymapContainers();

    if (testContainers.length) {
        if (!isOn) {
            testContainers.forEach(el => {
                el.classList.add('opacity-0');
                el.classList.add('hidden');
            });
        } else {
            const args = getKeymapRenderArgs();
            if (typeof window.renderKeymap === 'function') {
                window.renderKeymap(args.useNumbers, args.usePunctuation, langFile);
            }
            testContainers.forEach(el => {
                el.classList.remove('hidden');
                requestAnimationFrame(() => el.classList.remove('opacity-0'));
            });
            if (typeof window.updateKeymapHighlight === 'function') {
                requestAnimationFrame(() => window.updateKeymapHighlight());
            }
        }
        syncTypingScrollForKeymap(isOn);
    }

    if (isSettingsKeymapPreviewPage() && typeof window.renderKeymap === 'function') {
        window.renderKeymap(true, true, langFile);
    }
}

/**
 * Apply keyboard layout settings.
 */
function applyKeyboardLayoutSettings(settings) {
    if (!settings) settings = loadSettings();
    if (!document.body) return;

    if (typeof window.syncKeymapLayoutForLanguage === 'function') {
        window.syncKeymapLayoutForLanguage(settings);
    }

    const kl = settings.keyboardLayout || DEFAULTS.keyboardLayout;
    const shortcutsOn = kl.keyboardShortcuts !== false;
    const quickRestartOn = kl.quickRestart !== false;
    document.body.setAttribute('data-keyboard-shortcuts', shortcutsOn ? 'on' : 'off');
    document.body.setAttribute('data-quick-restart', quickRestartOn ? 'on' : 'off');

    document.querySelectorAll('[data-shortcut-tip="tab"]').forEach((el) => {
        el.classList.toggle('hidden', !quickRestartOn);
    });
    document.querySelectorAll('[data-shortcut-tip="esc"]').forEach((el) => {
        const quickSettingsOn = kl.quickSettings !== false;
        el.classList.toggle('hidden', !quickSettingsOn);
    });

    applyKeymapDisplay(settings);
}

/** Master switch: when false, app keyboard shortcuts must not run. */
function areKeyboardShortcutsEnabled(settings) {
    if (!settings) {
        settings = window.usertypo_settings || loadSettings();
    }
    return settings?.keyboardLayout?.keyboardShortcuts !== false;
}

/** Tab quick-restart toggle (independent of the Keyboard Shortcuts master switch). */
function isQuickRestartEnabled(settings) {
    if (!settings) {
        settings = window.usertypo_settings || loadSettings();
    }
    const v = settings?.keyboardLayout?.quickRestart;
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null) return true;
    return v === 'Tab';
}

/**
 * When Keyboard Shortcuts is off, block Enter / \\ app shortcuts site-wide.
 * Tab quick-restart and Esc quick settings are controlled by their own toggles.
 * Form fields and the contact dialog still need Enter for typing / submit.
 */
document.addEventListener('keydown', (e) => {
    if (areKeyboardShortcutsEnabled()) return;
    if (e.key !== 'Enter' && e.key !== '\\') return;
    const target = e.target;
    if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
        if (typeof target.closest === 'function' && target.closest('#contact-modal, #configure-dual-modal, form')) return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);

/**
 * Apply live feed / timer display settings on index and room pages.
 */
function applyLiveFeedSettings(settings) {
    if (!settings) settings = loadSettings();
    const lf = settings.liveFeed || DEFAULTS.liveFeed;
    const testActive = isTestSessionActive();

    const liveWpmWrapper = document.getElementById('live-wpm-wrapper');
    if (liveWpmWrapper) {
        const showWpm = lf.liveWpm !== false;
        const showAcc = lf.liveAccuracy !== false;
        const showBurst = lf.liveBurst === true;

        liveWpmWrapper.classList.toggle('hidden', !showWpm);
        document.getElementById('live-acc-wrapper')?.classList.toggle('hidden', !showAcc);
        document.getElementById('live-burst-wrapper')?.classList.toggle('hidden', !showBurst);

        const wpmDivider = document.getElementById('live-wpm-divider');
        const accDivider = document.getElementById('live-acc-divider');
        if (wpmDivider) wpmDivider.classList.toggle('hidden', !(showWpm && showAcc));
        if (accDivider) accDivider.classList.toggle('hidden', !(showAcc && showBurst));
        if (showWpm && !showAcc && showBurst && wpmDivider) wpmDivider.classList.remove('hidden');

        const timerStyle = lf.timerStyle || 'Number';
        const timerOpacity = parseFloat(lf.timerOpacity || '0.5');
        const timerProgressWrapper = document.getElementById('timer-progress-wrapper');
        const wordProgressText = document.getElementById('word-progress');
        const wordProgressBarContainer = document.getElementById('word-progress-bar-container');
        const liveStatsContainer = document.getElementById('live-stats-container');

        if (timerProgressWrapper) {
            if (timerStyle === 'Off') {
                timerProgressWrapper.style.visibility = 'hidden';
            } else {
                timerProgressWrapper.style.visibility = 'visible';
                if (timerStyle === 'Bar') {
                    wordProgressText?.classList.add('hidden');
                    wordProgressBarContainer?.classList.remove('hidden');
                } else {
                    wordProgressText?.classList.remove('hidden');
                    wordProgressBarContainer?.classList.add('hidden');
                }
            }
            // Only paint live opacity while typing — never override .opacity-0 pre-test
            if (testActive) {
                timerProgressWrapper.style.opacity = timerOpacity.toString();
            } else {
                timerProgressWrapper.style.opacity = '';
            }
        }
        if (liveStatsContainer) {
            if (testActive) {
                liveStatsContainer.style.opacity = timerOpacity.toString();
            } else {
                // Clear any leftover inline opacity so Tailwind .opacity-0 works again
                liveStatsContainer.style.opacity = '';
                liveStatsContainer.classList.add('opacity-0');
            }
        }

        // Keep timer/progress digits hidden until the test starts
        if (!testActive) {
            document.querySelectorAll('.typing-stat').forEach(el => {
                el.style.opacity = '';
                el.classList.add('opacity-0');
            });
        }
    }

    if (typeof window.applyRoomLiveFeedSettings === 'function') {
        window.applyRoomLiveFeedSettings();
    }

    if (typeof window.applyDualLiveFeedSettings === 'function') {
        window.applyDualLiveFeedSettings();
    }
}

function isTestSessionActive() {
    if (typeof window.usertypo_testRuntime?.isActive === 'function') {
        return window.usertypo_testRuntime.isActive();
    }
    return false;
}

function applyAllSettings(settings) {
    if (!settings) settings = loadSettings();
    applyCursorSettings(settings);
    applySoundscapeSettings(settings);
    applyTestRulesSettings(settings);
    applyKeyboardLayoutSettings(settings);
    applyThemeSettings(settings);
    applyLiveFeedSettings(settings);
    applyFooterSettings(settings);
    refreshActiveTestVisuals();
}

function refreshActiveTestVisuals() {
    if (typeof window.updateCaretPosition === 'function') {
        requestAnimationFrame(() => window.updateCaretPosition());
    }
    if (typeof window.refreshPaceCaretVisual === 'function') {
        requestAnimationFrame(() => window.refreshPaceCaretVisual());
    }
    if (typeof window.updateLineLayout === 'function') {
        requestAnimationFrame(() => window.updateLineLayout());
    }
}


// ─────────────────────────────────────────────────────────────────────────────
//  4. ADAPTIVE SMOOTHNESS
//
//  When enabled, the caret transition duration scales with WPM:
//    - Slow typing (≤20 WPM)  → 300ms (smooth, relaxed)
//    - Fast typing (≥160 WPM) → 35ms  (snappy, keeps up)
//
//  Reads the live WPM from #wpm-display every 500ms and interpolates.
// ─────────────────────────────────────────────────────────────────────────────

let _adaptiveInterval = null;

function setupAdaptiveSmoothness(enabled) {
    if (_adaptiveInterval) {
        clearInterval(_adaptiveInterval);
        _adaptiveInterval = null;
    }
    if (!enabled) return;

    _adaptiveInterval = setInterval(() => {
        const wpmEl = document.getElementById('wpm-display') || document.getElementById('room-wpm-display');
        if (!wpmEl) return;

        const wpm = parseInt(wpmEl.textContent) || 0;
        const minWpm = 20, maxWpm = 160;
        const minDur = 35, maxDur = 300; // ms

        const clamped = Math.max(minWpm, Math.min(maxWpm, wpm));
        const t = (clamped - minWpm) / (maxWpm - minWpm);
        const dur = Math.round(maxDur - t * (maxDur - minDur));

        const ease = 'cubic-bezier(0.2, 0, 0.2, 1)';
        const transition = `transform ${dur}ms ${ease}, width ${dur}ms ${ease}, opacity 0.5s ease-in-out`;
        const tapeMode = document.body?.getAttribute('data-tape-mode') || '';
        const isTape = tapeMode === 'letter' || tapeMode === 'word';

        // In tape mode, keep caret + line scroll on the same duration so the
        // caret stays visually locked while the line still feels smooth.
        const caretTransition = isTape
            ? `transform ${dur}ms ${ease}, width 0s, opacity 0.5s ease-in-out`
            : transition;
        const lineTransition = `filter 0.3s ease-in-out, opacity 0.5s ease-in-out, transform ${dur}ms ${ease}`;

        const caret = document.getElementById('caret');
        if (caret) caret.style.transition = caretTransition;

        const paceCaret = document.getElementById('pace-caret');
        if (paceCaret) paceCaret.style.transition = caretTransition;

        if (isTape) {
            const textContainer = document.getElementById('text-container')
                || document.getElementById('room-text-container');
            if (textContainer) textContainer.style.transition = lineTransition;
        }
    }, 500);
}


// ─────────────────────────────────────────────────────────────────────────────
//  5. CARET WIDTH FIX for "line" style
//
//  updateCaretPosition() in index.html sets caret.style.width to the full
//  character width. For "line" we need 2.5px. The !important in our
//  injected CSS handles this (stylesheet !important beats inline style).
//  
//  But as a safety net, we also observe style mutations to re-enforce it.
// ─────────────────────────────────────────────────────────────────────────────

function setupCaretWidthGuard() {
    const caret = document.getElementById('caret');
    if (!caret) return;

    const observer = new MutationObserver(() => {
        const style = getByPath(loadSettings(), 'cursor.caretStyle');
        if (style === 'line' && caret.style.width !== '2.5px') {
            caret.style.width = '2.5px';
        }
    });
    observer.observe(caret, { attributes: true, attributeFilter: ['style'] });
}


// ─────────────────────────────────────────────────────────────────────────────
//  6. UI RESTORE — restore settings page controls to match saved state
// ─────────────────────────────────────────────────────────────────────────────

function restoreUI(settings) {
    // Restore opt-btn groups
    document.querySelectorAll('[data-setting]').forEach(container => {
        const path = container.dataset.setting;
        const saved = getByPath(settings, path);
        if (saved === undefined) return;

        // Toggle tracks
        if (container.classList.contains('toggle-track')) {
            container.classList.toggle('on', !!saved);
            return;
        }

        // Sliders
        const rangeInput = container.querySelector('input[type="range"]');
        if (rangeInput) {
            rangeInput.value = saved;
            rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // Opt-btn groups — normalize saved value for comparison
        const savedNorm = String(saved).replace(/\s+/g, ' ').trim();
        container.querySelectorAll('.opt-btn').forEach(btn => {
            const btnVal = resolveOptValue(btn); // already whitespace-normalized
            btn.classList.toggle('active', btnVal === savedNorm);
        });

        // Setting Select — update the label to show the active option
        if (container.closest('.sub-setting-card')) {
            const card = container.closest('.sub-setting-card');
            const selectBtn = card.querySelector('.setting-select span.truncate');
            if (selectBtn) {
                const activeBtn = container.querySelector('.opt-btn.active');
                if (activeBtn) selectBtn.textContent = resolveOptValue(activeBtn);
                else selectBtn.textContent = saved;
            }
        }
    });

    // Restore language buttons
    const savedLang = (settings.languageContent && settings.languageContent.testLanguage) || 'english';
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang-file') === savedLang);
    });

    // Update language select button label
    document.querySelectorAll('.lang-btn.active').forEach(activeBtn => {
        const card = activeBtn.closest('.sub-setting-card');
        if (card) {
            const selectBtn = card.querySelector('.setting-select span.truncate');
            if (selectBtn) selectBtn.textContent = activeBtn.textContent.trim();
        }
    });

    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
}


// ─────────────────────────────────────────────────────────────────────────────
//  7. PERSISTENCE — hook into selectOpt / toggleSwitch
// ─────────────────────────────────────────────────────────────────────────────

function persistFromOpt(btn) {
    const path = getSettingPath(btn);
    if (!path) return;

    const settings = loadSettings();
    const value = resolveOptValue(btn);
    setByPath(settings, path, value);

    // Mode changes always apply a live custom theme (Paper/Abyss seeded)
    if (path === 'lookFeel.customTheme.mode') {
        commitCustomTheme({ mode: value }, { seedFromMode: true });
        return;
    }

    saveSettings(settings);
    applyAllSettings(settings);

    if (path === 'lookFeel.colorTheme') {
        syncColorThemeSelectLabel(settings);
        syncCustomThemeEditor(settings);
    }

    if (path.startsWith('soundscape.') && typeof window.playKeystrokeSound === 'function') {
        // slight delay to let the soundpack load if it changed
        setTimeout(() => window.playKeystrokeSound('a'), 100);
    }
}

function persistFromToggle(track) {
    const path = getSettingPath(track);
    if (!path) return;

    const settings = loadSettings();
    setByPath(settings, path, track.classList.contains('on'));
    saveSettings(settings);
    applyAllSettings(settings);

    if (path.startsWith('soundscape.') && typeof window.playKeystrokeSound === 'function') {
        if (path === 'soundscape.errorSounds') {
            if (typeof window.playErrorSound === 'function') window.playErrorSound();
        } else {
            window.playKeystrokeSound('a');
        }
    }
}


function restoreCustomButtonValues() {
    const settings = loadSettings();
    const thresholdPaths = [
        { path: 'resultsAndGraphs.minWPM', labels: ['Custom'] },
        { path: 'resultsAndGraphs.minAccuracy', labels: ['Custom'] },
    ];

    thresholdPaths.forEach(({ path }) => {
        const saved = getByPath(settings, path);
        if (!saved || saved === 'Off') return;

        const container = document.querySelector(`[data-setting="${path}"]`);
        if (!container) return;

        let matchedRegular = false;
        container.querySelectorAll('.opt-btn').forEach(b => {
            if (!b.closest('.custom-popover-wrapper')) {
                const btnText = b.textContent.trim();
                if (btnText === String(saved)) matchedRegular = true;
            }
        });
        if (matchedRegular) return;

        container.querySelectorAll('.custom-popover-wrapper > .opt-btn').forEach(triggerBtn => {
            const btnLabel = triggerBtn.textContent.trim();
            if (btnLabel === 'Custom' || triggerBtn.getAttribute('data-original-text') === 'Custom') {
                triggerBtn.setAttribute('data-original-text', 'Custom');
                triggerBtn.textContent = saved;
                container.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
                triggerBtn.classList.add('active');
            }
        });
    });

    restorePaceCaretCustomButton(settings);
}

function restorePaceCaretCustomButton(settings) {
    const mode = String(settings?.cursor?.paceCaretMode || '').toLowerCase();
    if (mode !== 'custom') return;

    const container = document.querySelector('[data-setting="cursor.paceCaretMode"]');
    if (!container) return;

    const triggerBtn = container.querySelector('.custom-popover-wrapper > .opt-btn');
    if (!triggerBtn) return;

    const speed = Number(settings.cursor.paceCaretCustomSpeed);
    if (!triggerBtn.hasAttribute('data-original-text')) {
        triggerBtn.setAttribute('data-original-text', 'Custom');
    }
    if (isFinite(speed) && speed > 0) {
        triggerBtn.textContent = String(Math.round(speed) === speed ? Math.round(speed) : speed);
    }

    container.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
    triggerBtn.classList.add('active');
}

/** Wire settings page controls after DOM is present (standalone load or SPA navigation). */
function initSettingsPage() {
    const root = document.getElementById('settings-container');
    if (!root) return;

    const settings = loadSettings();
    restoreUI(settings);
    restoreCustomButtonValues();
    initCustomThemeEditor();

    if (!root.dataset.usertypoOptWired) {
        root.dataset.usertypoOptWired = '1';

        if (typeof window.selectOpt === 'function') {
            const _orig = window.selectOpt;
            window.selectOpt = function (btn) {
                const container = btn.closest('[data-setting]');
                if (container) {
                    container.querySelectorAll('.opt-btn').forEach(b => {
                        if (b.hasAttribute('data-original-text')) {
                            b.textContent = b.getAttribute('data-original-text');
                            b.removeAttribute('data-original-text');
                        }
                    });
                }
                _orig(btn);
                persistFromOpt(btn);
                const path = getSettingPath(btn);
                if (path && path.startsWith('keyboardLayout.')) {
                    applyKeymapDisplay(loadSettings());
                }
            };
        }

        if (typeof window.toggleSwitch === 'function') {
            const _orig = window.toggleSwitch;
            window.toggleSwitch = function (track) {
                _orig(track);
                persistFromToggle(track);
            };
        }
    }

    if (!root.dataset.usertypoSliderDelegation) {
        root.dataset.usertypoSliderDelegation = '1';

        const persistSlider = (slider, { previewOnly = false } = {}) => {
            const container = slider.closest('[data-setting]');
            if (!container) return;
            const path = container.dataset.setting;
            const sets = loadSettings();
            const value = parseInt(slider.value, 10);
            setByPath(sets, path, value);

            if (path === 'lookFeel.glowIntensity') {
                // Live preview via CSS variable; persist on change (not every input tick)
                applyGlowIntensityVar(sets);
                if (!previewOnly) {
                    saveSettings(sets);
                    if (typeof window.triggerSave === 'function') window.triggerSave();
                }
                return;
            }

            if (previewOnly) return;

            saveSettings(sets);
            applySoundscapeSettings(sets);
            if (typeof window.triggerSave === 'function') window.triggerSave();

            if (path === 'soundscape.masterVolume' && typeof window.playKeystrokeSound === 'function') {
                window.playKeystrokeSound('a');
            }
        };

        root.addEventListener('input', (e) => {
            const slider = e.target;
            if (!slider.matches || !slider.matches('input[type="range"].custom-slider')) return;
            const path = slider.closest('[data-setting]')?.dataset.setting;
            if (path === 'lookFeel.glowIntensity') {
                persistSlider(slider, { previewOnly: true });
            }
        });

        root.addEventListener('change', (e) => {
            const slider = e.target;
            if (!slider.matches || !slider.matches('input[type="range"].custom-slider')) return;
            persistSlider(slider, { previewOnly: false });
        });
    }

    applyKeymapDisplay(settings);
    if (typeof window._initLang === 'function') {
        try { window._initLang({ skipRestart: true }); } catch (e) { /* ignore */ }
    }
}


// ─────────────────────────────────────────────────────────────────────────────
//  8. INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

(function init() {
    // Inject CSS immediately at parse time (before DOMContentLoaded)
    try { applyCursorSettings(); } catch { /* body not ready yet */ }
    try { applyThemeSettings(); } catch { /* body not ready yet */ }

    // Wire Custom Theme preset play/save handlers as soon as settings.js loads,
    // so play works even before /settings finishes its page-local init.
    try { initCustomThemeEditor(); } catch { /* editors may not exist yet */ }

    document.addEventListener('DOMContentLoaded', () => {
        const settings = loadSettings();

        // Re-apply (body now exists for data attributes)
        applyCursorSettings(settings);
        applySoundscapeSettings(settings);
        applyTestRulesSettings(settings);
        applyKeyboardLayoutSettings(settings);
        applyThemeSettings(settings);
        applyFooterSettings(settings);

        if (window.usertypo_footerPicker?.init) {
            window.usertypo_footerPicker.init();
        }

        // Setup caret width guard for "line" style
        setupCaretWidthGuard();

        initSettingsPage();
    });
})();

// ─────────────────────────────────────────────────────────────────────────────
//  8b. LIVE SETTINGS SYNC — apply settings instantly across tabs / pages
//
//  Three mechanisms ensure changes made on the settings page are reflected
//  immediately on the index page without requiring a manual reload:
//
//  1. `storage`          — fires when localStorage changes in ANOTHER tab
//  2. `pageshow`         — fires on bfcache restoration (browser Back button)
//  3. `visibilitychange` — fires when the user switches back to this tab
// ─────────────────────────────────────────────────────────────────────────────

function _isOnSettingsPage() {
    const path = location.pathname || '';
    if (path === '/settings') return true;
    return /settings\.html/i.test(path.split('/').pop() || '');
}

function _reapplyAllSettings() {
    const settings = loadSettings();
    applyAllSettings(settings);

    if (_isOnSettingsPage()) {
        restoreUI(settings);
        applyKeymapDisplay(settings);
    }

    // Only restart when on a typing page — never on settings or other routes.
    // Do not randomize theme here: changing a setting must not shuffle themes;
    // Randomize Theme only applies on intentional next-test / restart.
    const path = (location.pathname || '').replace(/\/+$/, '') || '/';
    const onTypingPage = path === '/' || path === '/room' || path === '/dual';
    if (onTypingPage && !isTestSessionActive() && typeof window.restartTest === 'function') {
        try {
            window.restartTest({ randomizeTheme: false });
        } catch (e) { /* typing DOM may not be mounted yet */ }
    }
}

/**
 * Wipe local settings back to shipped defaults and refresh UI/theme/audio.
 */
function resetToDefaults() {
    const settings = cloneDefaults();
    saveSettings(settings);
    applyAllSettings(settings);

    if (_isOnSettingsPage()) {
        try {
            restoreUI(settings);
            applyKeymapDisplay(settings);
        } catch (e) { /* ignore */ }
    }

    return settings;
}

// 1. Cross-tab sync: another tab (settings page) wrote to localStorage
window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
        _reapplyAllSettings();
    }
});

// 2. bfcache restoration: user hit Back to return to this page
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        _reapplyAllSettings();
    }
});

// 3. Tab switch: user was on the settings tab and switched back here.
//    Only refresh visuals (theme, cursor, etc.) — do NOT restart the test;
//    that's too disruptive when the user is just Alt-Tabbing or checking
//    a reference.  Cross-tab setting changes are already covered by the
//    'storage' event above.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        const settings = loadSettings();
        applyAllSettings(settings);
        if (_isOnSettingsPage()) {
            try {
                restoreUI(settings);
                applyKeymapDisplay(settings);
            } catch (e) { /* ignore */ }
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  9. KEYMAP RENDER LOGIC
//  Layout tables live in js/keymap-layouts.js (loaded before this file).
//  Main legend = language glyph; small legend = US QWERTY key at that position.
// ─────────────────────────────────────────────────────────────────────────────

window.renderKeymap = function (useNumbers = true, usePunctuation = true, langFileOverride) {
    const settings = loadSettings();
    if (!settings.keyboardLayout) settings.keyboardLayout = {};
    const kl = settings.keyboardLayout;
    const legend = kl.keymapLegend || 'Lowercase';

    const langFile = (typeof window.resolveActiveLanguageFile === 'function')
        ? window.resolveActiveLanguageFile(langFileOverride || settings.languageContent?.testLanguage)
        : (langFileOverride || settings.languageContent?.testLanguage || 'english');

    const layoutName = (typeof window.resolveLanguageKeymapLayout === 'function')
        ? window.resolveLanguageKeymapLayout(langFile)
        : 'QWERTY';

    // Keep persisted setting aligned with the active language
    if (kl.keymapLayout !== layoutName) {
        kl.keymapLayout = layoutName;
        saveSettings(settings);
    }

    const containers = document.querySelectorAll('#dynamic-keymap');
    if (containers.length === 0) return;

    let layoutData = null;
    if (typeof window.getKeymapLayoutData === 'function') {
        layoutData = window.getKeymapLayoutData(layoutName);
    } else if (typeof window.getKeymapLayoutDataForLanguage === 'function') {
        layoutData = window.getKeymapLayoutDataForLanguage(langFile);
    } else if (window.keymapLayouts) {
        layoutData = window.keymapLayouts[layoutName] || window.keymapLayouts.QWERTY;
    }
    if (!layoutData) {
        console.warn('[keymap] No layout data for', layoutName, langFile);
        return;
    }

    let html = '';

    const isLetterLike = (typeof window.isKeymapLetterLike === 'function')
        ? window.isKeymapLetterLike
        : (ch) => typeof ch === 'string' && ch.length === 1 && /[a-zA-Z]/i.test(ch);

    const isModifier = (typeof window.isKeymapModifier === 'function')
        ? window.isKeymapModifier
        : (name) => ['Backspace', 'Tab', 'Caps', 'Enter', 'Shift', 'Space'].includes(name);

    const isNumberKey = (k, s) => {
        const numChars = '0123456789';
        return numChars.includes(k) || (s && numChars.includes(s));
    };

    const applyLegend = (text, mode) => {
        if (!text) return '';
        if (mode === 'Blank') return '';
        if (mode === 'Uppercase') return text.toUpperCase();
        if (mode === 'Lowercase' || mode === 'Dynamic') return text.toLowerCase();
        return text;
    };

    layoutData.forEach((row) => {
        let rowHasVisibleKeys = false;
        row.forEach((keyObj) => {
            const k = keyObj.k;
            const s = keyObj.s || '';
            const letter = isLetterLike(k);
            let isVisible = true;
            if (usePunctuation) {
                isVisible = true;
            } else if (useNumbers) {
                isVisible = letter || isNumberKey(k, s) || k === 'Space' || k === 'Backspace';
            } else {
                isVisible = letter || k === 'Space';
            }
            if (isVisible) rowHasVisibleKeys = true;
        });

        if (!rowHasVisibleKeys) return;

        html += '<div class="flex gap-[0.32rem] w-full justify-center min-w-max">';
        row.forEach((keyObj) => {
            const u = keyObj.u || 1;
            const widthRem = u * 1.705 + (u - 1) * 0.32;
            const rawMain = keyObj.k;
            const rawQwerty = keyObj.q || '';
            const modifier = isModifier(rawMain);

            const letter = isLetterLike(rawMain);
            let isVisible = true;
            if (usePunctuation) {
                isVisible = true;
            } else if (useNumbers) {
                isVisible = letter || isNumberKey(rawMain, keyObj.s || '') || rawMain === 'Space' || rawMain === 'Backspace';
            } else {
                isVisible = letter || rawMain === 'Space';
            }

            let keyText = '';
            let qwertyText = '';
            if (modifier) {
                keyText = rawMain === 'Space' ? '' : rawMain;
            } else {
                keyText = applyLegend(rawMain, legend);
                qwertyText = applyLegend(rawQwerty, legend);
                // On plain QWERTY, hide duplicate secondary labels
                if (layoutName === 'QWERTY' && qwertyText && keyText
                    && qwertyText.toLowerCase() === keyText.toLowerCase()) {
                    qwertyText = '';
                }
            }

            const visibilityClass = isVisible ? '' : 'hidden';

            let charBag = `${rawMain || ''}${keyObj.s || ''}${rawQwerty || ''}`;
            if (rawMain && rawMain.length === 1 && isLetterLike(rawMain)) {
                const up = rawMain.toUpperCase();
                const lo = rawMain.toLowerCase();
                if (up !== lo) {
                    if (!charBag.includes(up)) charBag += up;
                    if (!charBag.includes(lo)) charBag += lo;
                }
            }
            if (rawQwerty && rawQwerty.length === 1 && /[a-z]/i.test(rawQwerty)) {
                const up = rawQwerty.toUpperCase();
                const lo = rawQwerty.toLowerCase();
                if (!charBag.includes(up)) charBag += up;
                if (!charBag.includes(lo)) charBag += lo;
            }

            let dataAttr = `data-chars="${charBag.replace(/"/g, '&quot;')}"`;
            if (modifier) {
                dataAttr = `data-special="${String(rawMain || '').replace(/"/g, '&quot;')}"`;
            }
            if (rawQwerty) {
                dataAttr += ` data-qwerty="${String(rawQwerty).replace(/"/g, '&quot;')}"`;
            }

            if (modifier) {
                html += `<div ${dataAttr} style="width: ${widthRem}rem" class="keymap-key ${visibilityClass} h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[0.533rem] font-semibold text-primary transition-all duration-75">${keyText}</div>`;
            } else if (qwertyText && isVisible) {
                html += `<div ${dataAttr} style="width: ${widthRem}rem" class="keymap-key ${visibilityClass} h-8 rounded-lg bg-primary/10 border border-primary/20 flex flex-col items-start justify-between p-1 pt-0.5 text-[0.453rem] font-semibold text-primary/60 transition-all duration-75 relative">
                     <span class="keymap-shift-text keymap-qwerty-text">${qwertyText}</span>
                     <span class="keymap-main-text text-[0.56rem] text-primary leading-none ml-[0.053rem] mb-[0.053rem]">${keyText}</span>
                 </div>`;
            } else {
                html += `<div ${dataAttr} style="width: ${widthRem}rem" class="keymap-key ${visibilityClass} h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[0.533rem] font-semibold text-primary transition-all duration-75 relative"><span class="keymap-main-text">${keyText}</span></div>`;
            }
        });
        html += '</div>';
    });

    containers.forEach((c) => {
        c.dataset.keymapLayout = layoutName;
        c.dataset.keymapLanguage = langFile;
        c.innerHTML = html;
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. CUSTOM POPOVER LOGIC — with CSS overrides for transparent styling
// ─────────────────────────────────────────────────────────────────────────────

// Inject CSS to force transparent styling on custom popovers
// This overrides any Tailwind classes in the HTML (bg-slate-900, border-primary, etc.)
(function injectCustomPopoverCSS() {
    const style = document.createElement('style');
    style.id = 'custom-popover-override-css';
    style.textContent = `
        /* Force open-menu glass — matches #expanding-bubble.is-open */
        .custom-popover {
            background: var(--theme-menu-bg, rgba(68, 68, 68, 0.4)) !important;
            background-color: var(--theme-menu-bg, rgba(68, 68, 68, 0.4)) !important;
            background-image: none !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5) !important;
            /* Open to the RIGHT of the button, not below */
            top: 50% !important;
            left: 100% !important;
            right: auto !important;
            bottom: auto !important;
            transform: translateY(-50%) !important;
            margin-top: 0 !important;
            margin-left: 8px !important;
        }

        /* Glass-style input — same menu fill as popover shell */
        .custom-popover input {
            background: var(--theme-menu-bg, rgba(68, 68, 68, 0.4)) !important;
            background-image: none !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            color: var(--theme-fg-strong, #fff) !important;
            -moz-appearance: textfield !important;
            appearance: textfield !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
        }
        .custom-popover input:focus {
            border-color: rgba(255, 255, 255, 0.15) !important;
            outline: none !important;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
        }

        /* Remove number input spinners/arrows */
        .custom-popover input::-webkit-outer-spin-button,
        .custom-popover input::-webkit-inner-spin-button {
            -webkit-appearance: none !important;
            margin: 0 !important;
        }

        /* Glass-style Apply button */
        .custom-popover button {
            background: var(--theme-menu-bg, rgba(68, 68, 68, 0.4)) !important;
            background-image: none !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            color: var(--theme-fg-strong, #fff) !important;
        }
        .custom-popover button:hover {
            background: rgba(255, 255, 255, 0.08) !important;
            border-color: rgba(255, 255, 255, 0.1) !important;
        }

        /* Make sure parent cards don't clip the popover */
        .custom-popover-wrapper {
            position: relative;
        }
        .setting-card, .sub-setting-card, .sub-setting-content, .glass-card {
            overflow: visible !important;
        }
    `;
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    }
})();

// Toggle popover open/close
window.toggleCustomPopover = function (btn) {
    const popover = btn.nextElementSibling;
    const isShowing = popover.classList.contains('opacity-100');

    // Close all other popovers first
    document.querySelectorAll('.custom-popover').forEach(p => {
        p.classList.remove('opacity-100', 'pointer-events-auto');
        p.classList.add('opacity-0', 'pointer-events-none');
    });

    if (!isShowing) {
        popover.classList.remove('opacity-0', 'pointer-events-none');
        popover.classList.add('opacity-100', 'pointer-events-auto');
        const inp = popover.querySelector('input');
        if (inp) inp.focus();
    }
};

// Apply custom value
window.applyCustomPopover = function (btn, path, isFlex = false) {
    const popover = btn.closest('.custom-popover');
    const input = popover.querySelector('input');
    const val = input.value.trim();

    if (!val) {
        popover.classList.remove('opacity-100', 'pointer-events-auto');
        popover.classList.add('opacity-0', 'pointer-events-none');
        return;
    }

    const settings = loadSettings();
    let displayVal = val;
    let finalVal = isFlex ? 'Flex:' + val : val;

    if (path === 'cursor.paceCaretCustomSpeed') {
        const num = parseFloat(val);
        if (!isFinite(num) || num <= 0) {
            if (window.usertypoNotifications && typeof window.usertypoNotifications.showToast === 'function') {
                window.usertypoNotifications.showToast('wpm can only be above 0', 'error');
            } else if (typeof window.triggerSave === 'function') {
                window.triggerSave();
            } else {
                try { window.alert('wpm can only be above 0'); } catch (e) { /* ignore */ }
            }
            if (input) input.focus();
            return;
        }
        finalVal = num;
        displayVal = String(Math.round(num) === num ? Math.round(num) : num);
        setByPath(settings, 'cursor.paceCaretCustomSpeed', finalVal);
        setByPath(settings, 'cursor.paceCaretMode', 'custom');
    } else {
        setByPath(settings, path, finalVal);
    }

    saveSettings(settings);
    applyAllSettings(settings);
    if (typeof triggerSave === 'function') triggerSave();

    // UI update — set button text to the entered value
    const container = btn.closest('[data-setting]');
    if (container) {
        // Reset all buttons in this group
        container.querySelectorAll('.opt-btn').forEach(b => {
            b.classList.remove('active');
            if (b.hasAttribute('data-original-text')) {
                b.textContent = b.getAttribute('data-original-text');
            }
        });

        // Set the trigger button (the one right before the popover div) as active
        const optBtn = popover.previousElementSibling;
        if (optBtn) {
            optBtn.classList.add('active');
            // Save original text so we can restore it later
            if (!optBtn.hasAttribute('data-original-text')) {
                optBtn.setAttribute('data-original-text', 'Custom');
            }
            // Show the custom number on the button
            optBtn.textContent = displayVal;
        }
    }

    // Close the popover
    popover.classList.remove('opacity-100', 'pointer-events-auto');
    popover.classList.add('opacity-0', 'pointer-events-none');
    input.value = '';
};

// Close popover when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-popover-wrapper')) {
        document.querySelectorAll('.custom-popover').forEach(p => {
            p.classList.remove('opacity-100', 'pointer-events-auto');
            p.classList.add('opacity-0', 'pointer-events-none');
        });
    }
});

// Apply on Enter key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const popover = e.target.closest('.custom-popover');
        if (popover && e.target.tagName.toLowerCase() === 'input') {
            const applyBtn = popover.querySelector('button');
            if (applyBtn) {
                applyBtn.click();
            }
        }
    }
});

// Monkey-patch selectOpt to reset custom button text when a regular option is picked
// (handled inside initSettingsPage for SPA + standalone)

// On page load, restore custom values on buttons from saved settings
// (handled inside initSettingsPage for SPA + standalone)

// Public API for the global settings search overlay (settings-search.js)
window.usertypo_settingsApi = {
    loadSettings,
    saveSettings,
    setByPath,
    restoreUI,
    initSettingsPage,
    persistFromOpt,
    persistFromToggle,
    applySoundscapeSettings,
    applyLiveFeedSettings,
    applyFooterSettings,
    applyThemeSettings,
    applyGlowIntensityVar,
    normalizeGlowIntensity,
    applyAllSettings,
    applyKeymapDisplay,
    syncTypingScrollForKeymap,
    refreshActiveTestVisuals,
    reapplyAllSettings: _reapplyAllSettings,
    resetToDefaults,
    toggleFooterMute,
    selectColorTheme,
    maybeRandomizeTheme,
    areKeyboardShortcutsEnabled,
    isQuickRestartEnabled,
    resolveThemePalette,
    getThemeDisplayName,
    isThemeLight,
    isCustomThemeName,
    syncCustomThemeEditor,
    commitCustomTheme,
    applyCustomThemePreset,
    syncColorThemeSelectLabel,
    getLanguageDisplayName,
    isDualPage,
    isRoomPage,
    getEffectiveTapeMode,
};
