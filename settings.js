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

const DEFAULTS = {
    cursor: {
        caretStyle: 'line',      // line | block | underscore | outline
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
        errorSounds: 'beep', // Changed from boolean to string
        masterVolume: 50,
        muted: true,
        soundPack: 'Steelseries Apex Pro V2',
    },
    languageContent: {
        testLanguage: 'english_10k',
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
        quickRestart: 'Tab',
        quickRestartCustomKey: '',
    },
    resultsAndGraphs: {
        decimalPrecision: false,
        alwaysShowCPS: false,
        defaultGraphView: 'Basic',
        smoothGraphLines: true,
        startGraphFromZero: false,
        minWPM: 'Off',
        minAccuracy: '75%',
        minBurst: 'Off'
    },
    liveFeed: {
        liveWpm: true,
        liveAccuracy: true,
        liveBurst: false,
        timerStyle: 'Number',
        timerOpacity: '0.5',
    },
    lookFeel: {
        colorTheme: 'usertypo_',
        fontFamily: 'JetBrains Mono',
        randomizeTheme: 'Off',
        customTheme: {
            mode: 'Dark',
            mainColor: '#ffffff',
            secondaryColor: '#cccccc',
            bgColor: '#000000',
        },
        customPresets: [],
    }
};

const CUSTOM_THEME_DEFAULT = {
    mode: 'Dark',
    mainColor: '#ffffff',
    secondaryColor: '#cccccc',
    bgColor: '#000000',
};
const MAX_CUSTOM_PRESETS = 3;

function loadSettings() {
    let settings = structuredClone(DEFAULTS);
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            settings = deepMerge(settings, parsed);
        }
    } catch { /* corrupt — use defaults */ }

    // Sanitize any corrupted soundPack names from old saves
    if (settings.soundscape && settings.soundscape.soundPack) {
        settings.soundscape.soundPack = String(settings.soundscape.soundPack).replace(/\s+/g, ' ').trim();
    }

    // Migrate old boolean errorSounds to new string options ('beep', 'mute', 'off')
    if (settings.soundscape && typeof settings.soundscape.errorSounds === 'boolean') {
        settings.soundscape.errorSounds = settings.soundscape.errorSounds ? 'beep' : 'mute';
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
            };
        }
        if (!Array.isArray(settings.lookFeel.customPresets)) {
            settings.lookFeel.customPresets = [];
        } else {
            settings.lookFeel.customPresets = settings.lookFeel.customPresets
                .slice(0, MAX_CUSTOM_PRESETS)
                .map((p, i) => ({
                    name: (p && p.name) || `Custom ${i + 1}`,
                    mode: isLightModeValue(p?.mode) ? 'Light' : 'Dark',
                    mainColor: normalizeHexColor(p?.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
                    secondaryColor: normalizeHexColor(p?.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
                    bgColor: normalizeHexColor(
                        p?.bgColor || (isLightModeValue(p?.mode) ? '#ffffff' : '#000000'),
                        CUSTOM_THEME_DEFAULT.bgColor
                    ),
                }));
        }
        if (!settings.lookFeel.randomizeTheme) {
            settings.lookFeel.randomizeTheme = 'Off';
        }
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
        bgMain: '#ffffff',
        bgSecondary: '#b3b3b3',
        textPrimary: '#333333',
        textMuted: '#888888',
        accentPrimary: '#000000',
        accentHover: '#333333',
        error: '#cc0000',
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

function normalizeHexColor(value, fallback = '#00d0ff') {
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
            return {
                mode,
                mainColor: normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
                secondaryColor: normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
                bgColor: normalizeHexColor(
                    preset.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
                    CUSTOM_THEME_DEFAULT.bgColor
                ),
                name: preset.name || `Custom ${idx + 1}`,
                presetIndex: idx,
            };
        }
    }
    const live = lf.customTheme || CUSTOM_THEME_DEFAULT;
    const mode = isLightModeValue(live.mode) ? 'Light' : 'Dark';
    return {
        mode,
        mainColor: normalizeHexColor(live.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
        secondaryColor: normalizeHexColor(live.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
        bgColor: normalizeHexColor(
            live.bgColor || (mode === 'Light' ? '#ffffff' : '#000000'),
            CUSTOM_THEME_DEFAULT.bgColor
        ),
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

function spectrumPosFromBgColor(mode, hex) {
    const { h, s, l } = hexToHsl(hex);
    const light = isLightModeValue(mode);
    if (light) {
        if (l > 0.97 && s < 0.08) return 0;
        if (l > 0.9 && s < 0.08) return 1;
    } else {
        if (l < 0.03) return 0;
        if (l < 0.12 && s < 0.08) return 1;
    }
    return 0.05 + (h / 360) * 0.9;
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
        };
    }
    const base = THEME_PALETTES['Abyss'];
    return {
        mode: 'Dark',
        mainColor: normalizeHexColor(base?.accentPrimary, '#ffffff'),
        secondaryColor: normalizeHexColor(base?.textPrimary, '#cccccc'),
        bgColor: normalizeHexColor(base?.bgMain, '#000000'),
    };
}

function isCustomThemeName(themeName) {
    return themeName === 'custom' || (typeof themeName === 'string' && themeName.startsWith('custom:'));
}

function resolveThemePalette(settings, themeName) {
    if (!settings) settings = loadSettings();
    const name = themeName || settings.lookFeel?.colorTheme || 'usertypo_';
    if (isCustomThemeName(name)) {
        return buildCustomPalette(getCustomThemeConfig(settings, name));
    }
    return THEME_PALETTES[name] || THEME_PALETTES['usertypo_'];
}

function getThemeDisplayName(themeName, settings) {
    if (!settings) settings = loadSettings();
    if (isCustomThemeName(themeName || settings.lookFeel?.colorTheme)) return 'custom';
    return themeName || settings.lookFeel?.colorTheme || 'usertypo_';
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
        const pos = spectrumPosFromBgColor(cfg.mode, cfg.bgColor);
        if (slider && document.activeElement !== slider) {
            slider.value = String(Math.round(pos * 100));
        }
        const thumb = spectrum.querySelector('[data-bg-spectrum-thumb]');
        if (thumb) {
            thumb.style.left = `${pos * 100}%`;
            thumb.style.background = cfg.bgColor;
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
    const cfg = getCustomThemeConfig(settings, 'custom');
    forEachCustomThemeEditor((editor) => syncOneCustomThemeEditor(editor, settings, cfg));
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
    return {
        mode: isLightModeValue(mode) ? 'Light' : 'Dark',
        mainColor,
        secondaryColor,
        bgColor,
    };
}

/** Persist custom theme config and apply it site-wide immediately. */
function commitCustomTheme(partial, options = {}) {
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
    return commitCustomTheme(readCustomThemeFromEditor());
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
    const settings = loadSettings();
    const presets = settings.lookFeel?.customPresets;
    if (!Array.isArray(presets) || !presets[index]) return;
    const preset = presets[index];
    settings.lookFeel.customTheme = {
        mode: isLightModeValue(preset.mode) ? 'Light' : 'Dark',
        mainColor: normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
        secondaryColor: normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
        bgColor: normalizeHexColor(
            preset.bgColor || (isLightModeValue(preset.mode) ? '#ffffff' : '#000000'),
            CUSTOM_THEME_DEFAULT.bgColor
        ),
    };
    settings.lookFeel.colorTheme = `custom:${index}`;
    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
    if (typeof window.triggerSave === 'function') window.triggerSave();
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
    const themeName = settings.lookFeel?.colorTheme || 'usertypo_';
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

function initCustomThemeEditor() {
    // Document-level delegation so cloned Custom Theme panels (SPA sub-setting
    // copies via innerHTML) still receive events.
    if (!window.__usertypoCustomThemeDelegated) {
        window.__usertypoCustomThemeDelegated = true;

        document.addEventListener('input', (e) => {
            const spectrumSlider = e.target.closest?.('[data-custom-bg-spectrum]');
            if (spectrumSlider && spectrumSlider.closest('[data-custom-theme-editor]')) {
                const editor = spectrumSlider.closest('[data-custom-theme-editor]');
                const modeBtn = editor.querySelector('[data-custom-theme-mode] .opt-btn.active');
                const mode = modeBtn ? resolveOptValue(modeBtn) : 'Dark';
                const t = Number(spectrumSlider.value) / 100;
                const hex = bgColorFromSpectrum(mode, t);
                const thumb = editor.querySelector('[data-bg-spectrum-thumb]');
                if (thumb) {
                    thumb.style.left = `${t * 100}%`;
                    thumb.style.background = hex;
                }
                const face = editor.querySelector('[data-swatch-face="bgColor"]');
                const hexInput = editor.querySelector('[data-custom-hex="bgColor"]');
                if (face) face.style.background = hex;
                if (hexInput) hexInput.value = hex;
                commitCustomTheme({ ...readCustomThemeFromEditor(editor), bgColor: hex });
                return;
            }

            const input = e.target.closest?.('[data-custom-color]');
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

        document.addEventListener('change', (e) => {
            const input = e.target.closest?.('[data-custom-hex]');
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
            const input = e.target.closest?.('[data-custom-hex]');
            if (!input || !input.closest('[data-custom-theme-editor]')) return;
            e.preventDefault();
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
        }, true);

        document.addEventListener('click', (e) => {
            const applyBtn = e.target.closest?.('[data-custom-theme-apply]');
            if (applyBtn) {
                e.preventDefault();
                applyCustomThemeFromEditor();
                return;
            }
            const saveBtn = e.target.closest?.('[data-custom-theme-save]');
            if (saveBtn) {
                e.preventDefault();
                saveCustomThemePreset();
                return;
            }
            const applyPreset = e.target.closest?.('[data-preset-apply]');
            if (applyPreset) {
                e.preventDefault();
                applyCustomThemePreset(parseInt(applyPreset.dataset.presetApply, 10));
                return;
            }
            const deletePreset = e.target.closest?.('[data-preset-delete]');
            if (deletePreset) {
                e.preventDefault();
                deleteCustomThemePreset(parseInt(deletePreset.dataset.presetDelete, 10));
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
function applyThemeSettings(settings) {
    if (!settings) settings = loadSettings();
    const themeName = settings.lookFeel?.colorTheme || 'usertypo_';
    const p = resolveThemePalette(settings, themeName);

    // ── Font Family ──
    const fontFamily = settings.lookFeel?.fontFamily || 'Roboto Mono';

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

    const css = `
        /* ── Theme CSS custom properties (usable by any page/JS) ── */
        :root {
            --theme-primary: ${p.accentPrimary};
            --theme-primary-rgb: ${accentRGB};
            --theme-primary-hover: ${p.accentHover};
            --theme-primary-dark: ${accentDark};
            --theme-primary-light: ${accentLight};
            --theme-bg: ${p.bgMain};
            --theme-bg-secondary: ${p.bgSecondary};
            --theme-bg-secondary-rgb: ${bgSecRGB};
            --theme-menu-bg: rgba(${bgSecRGB}, 0.4);
            --theme-text: ${p.textPrimary};
            --theme-text-muted: ${p.textMuted};
            --theme-error: ${p.error};
            --theme-error-rgb: ${errorRGB};
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
        .bg-surface\\/40 { background-color: rgba(${bgSecRGB}, 0.4) !important; }
        .bg-surface\\/85 { background-color: rgba(${bgSecRGB}, 0.85) !important; }
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
        #app-backdrop {
            background-color: ${p.bgMain} !important;
        }
        [style*="background-color: #020016"],
        [style*="background:#020016"],
        .fixed.inset-0.z-0,
        div[style*="background-color"][style*="020016"] { background-color: ${p.bgMain} !important; }
        /* Radial glow overlay */
        div[style*="radial-gradient"] { background: radial-gradient(ellipse 70% 55% at 50% 38%, rgba(${accentRGB}, 0.05) 0%, transparent 72%) !important; }

        /* ── Glass panels — flat translucent (no light→dark gradient) ── */
        .glass-panel,
        .glass-card,
        #sidebar-menu,
        #expanding-bubble {
            background: var(--theme-menu-bg) !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
        }

        /* Settings surfaces — same flat glass as menu sidebar */
        #settings-nav-pill,
        .settings-panel-card,
        #panel-card,
        .search-input,
        .quick-btn,
        .search-result-item,
        .setting-info-popover,
        #save-toast > div,
        #info-portal,
        .setting-select,
        .sub-card-header,
        .opt-btn:not(.active):not(.highlighted) {
            background: rgba(${bgSecRGB}, 0.4) !important;
            background-image: none !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1) !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
        }
        #save-toast-inner {
            border-radius: 9999px !important;
        }
        .footer-pill,
        #footer-picker-box,
        .footer-picker-search,
        .footer-picker-pill,
        .footer-picker-theme-preview,
        .footer-picker-list-item:not(.is-active) {
            background: rgba(${bgSecRGB}, 0.4) !important;
            background-image: none !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1) !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
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
        #config-bar > div {
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.35), 0 8px 32px rgba(0,0,0,0.3) !important;
            border-color: rgba(${accentRGB}, 0.4) !important;
        }

        /* ── Error underline ── */
        .char.error-underline { text-decoration-color: ${p.error} !important; }

        /* ── Logo layers (theme-aware) ── */
        .header-typ-layer  { background-color: ${logoTypColor} !important; }
        .header-user-layer { background-color: ${logoUserColor} !important; }
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
        [style*="box-shadow"][style*="0,208,255"],
        [style*="box-shadow"][style*="0, 208, 255"],
        [style*="box-shadow"][style*="108, 218, 255"],
        [style*="box-shadow"][style*="108,218,255"] {
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.35), 0 8px 32px rgba(0,0,0,0.3) !important;
        }

        /* ── Config bar inline style override ── */
        #config-bar > div[style] {
            box-shadow: 0 0 12px rgba(${accentRGB}, 0.35), 0 8px 32px rgba(0,0,0,0.3) !important;
            border-color: rgba(${accentRGB}, 0.4) !important;
        }

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
        .field-wrap input:not(:placeholder-shown) ~ label { color: ${p.accentPrimary} !important; }
        .field-wrap::after { background: ${p.accentPrimary} !important; box-shadow: 0 0 8px rgba(${accentRGB}, 0.6) !important; }

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

        /* ── Sign-in side underscore ── */
        .side-underscore {
            background-color: ${logoTypColor} !important;
            box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7) !important;
        }
        @keyframes side-caret-typing {
            0% { left: 132px; opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1); }
            20%, 25% { left: 176px; opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1); }
            45%, 50% { left: 225px; opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1); }
            70%, 75% { left: 274px; opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1); }
            95%, 100% { left: 326px; opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); }
        }
        @keyframes side-underscore-breath {
            0%, 100% { opacity: 1; box-shadow: 0 0 12px rgba(${logoTypRGB}, 0.7); }
            50% { opacity: 0.3; box-shadow: 0 0 4px rgba(${logoTypRGB}, 0.2); }
        }

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
            background: linear-gradient(145deg, rgba(${accentRGB}, 0.04) 0%, rgba(${bgSecRGB}, 0.3) 100%) !important;
        }
        .opt-btn,
        .setting-select,
        .sub-card-header {
            border-radius: 9999px !important;
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
    `;

    let tag = document.getElementById('usertypo-theme-css');
    if (!tag) {
        tag = document.createElement('style');
        tag.id = 'usertypo-theme-css';
    }
    // Always append to end of head to override inline page styles
    if (document.head) document.head.appendChild(tag);

    tag.textContent = css;

    // Expose live accent for page scripts (copy flash, widgets, etc.)
    try {
        window.usertypo_themeAccent = p.accentPrimary;
        window.usertypo_themeAccentRGB = accentRGB;
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
    accentHex = accentHex || '#00d0ff';
    accentRGB = accentRGB || '0, 208, 255';
    const dur = SMOOTHNESS_DURATION[smoothness] || SMOOTHNESS_DURATION.medium;
    const ease = 'cubic-bezier(0.2, 0, 0.2, 1)';
    const transition = `transform ${dur} ${ease}, width ${dur} ${ease}, opacity 0.5s ease-in-out`;

    let css = '';

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
            break;
    }

    return css;
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

function buildLayoutCSS(smoothLineScroll, tapeMode) {
    let css = '';

    // Scroll transition speed (same for normal + tape mode — matches index.html feel)
    if (smoothLineScroll) {
        css += `
            #text-container,
            #room-text-container {
                transition: filter 0.3s ease-in-out,
                            opacity 0.5s ease-in-out,
                            transform 0.25s cubic-bezier(0.2, 0, 0.2, 1) !important;
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

    const _themeName = settings.lookFeel?.colorTheme || 'usertypo_';
    const _palette = resolveThemePalette(settings, _themeName);
    const _caretAccent = _palette.accentPrimary;
    const _caretRGB = _hexToRGB(_caretAccent);
    styleEl.textContent = buildCaretCSS(settings.cursor.caretStyle, settings.cursor.caretSmoothness, _caretAccent, _caretRGB)
        + buildPaceCaretCSS(settings.cursor.paceCaretStyle, settings.cursor.caretSmoothness)
        + buildLayoutCSS(settings.cursor.smoothLineScroll, effectiveTapeMode);

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
        document.getElementById('pace-caret')?.style.removeProperty('transition');
    }
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
    const file = langFile || 'english_10k';
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

    const themeName = settings.lookFeel?.colorTheme || 'usertypo_';
    const themeLabel = getThemeDisplayName(themeName, settings);
    const langFile = settings.languageContent?.testLanguage || 'english_10k';
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
            settings.lookFeel.customTheme = {
                mode: isLightModeValue(preset.mode) ? 'Light' : 'Dark',
                mainColor: normalizeHexColor(preset.mainColor, CUSTOM_THEME_DEFAULT.mainColor),
                secondaryColor: normalizeHexColor(preset.secondaryColor, CUSTOM_THEME_DEFAULT.secondaryColor),
                bgColor: normalizeHexColor(
                    preset.bgColor || (isLightModeValue(preset.mode) ? '#ffffff' : '#000000'),
                    CUSTOM_THEME_DEFAULT.bgColor
                ),
            };
        }
    }

    setByPath(settings, 'lookFeel.colorTheme', themeName);
    saveSettings(settings);
    applyAllSettings(settings);
    syncColorThemeSelectLabel(settings);
    syncCustomThemeEditor(settings);
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
 */
function applyKeymapDisplay(settings) {
    if (!settings) settings = loadSettings();
    const kl = settings.keyboardLayout || DEFAULTS.keyboardLayout;
    const isOn = kl.keymapMode && kl.keymapMode !== 'Off';

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
                window.renderKeymap(args.useNumbers, args.usePunctuation);
            }
            testContainers.forEach(el => {
                el.classList.remove('hidden');
                requestAnimationFrame(() => el.classList.remove('opacity-0'));
            });
            if (typeof window.updateKeymapHighlight === 'function') {
                requestAnimationFrame(() => window.updateKeymapHighlight());
            }
        }
    }

    if (isSettingsKeymapPreviewPage() && typeof window.renderKeymap === 'function') {
        window.renderKeymap(true, true);
    }
}

/**
 * Apply keyboard layout settings.
 */
function applyKeyboardLayoutSettings(settings) {
    if (!settings) settings = loadSettings();
    if (!document.body) return;

    const kl = settings.keyboardLayout || DEFAULTS.keyboardLayout;
    document.body.setAttribute('data-quick-restart', kl.quickRestart || 'Tab');

    applyKeymapDisplay(settings);
}

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

        const caret = document.getElementById('caret');
        if (caret) caret.style.transition = transition;

        const paceCaret = document.getElementById('pace-caret');
        if (paceCaret) paceCaret.style.transition = transition;
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
        { path: 'resultsAndGraphs.minBurst', labels: ['Fixed', 'Flex'] }
    ];

    thresholdPaths.forEach(({ path, labels }) => {
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

            if (path === 'resultsAndGraphs.minBurst') {
                if (String(saved).startsWith('Flex:') && btnLabel === 'Flex') {
                    triggerBtn.setAttribute('data-original-text', 'Flex');
                    triggerBtn.textContent = String(saved).split(':')[1];
                    container.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
                    triggerBtn.classList.add('active');
                } else if (!String(saved).startsWith('Flex:') && btnLabel === 'Fixed') {
                    triggerBtn.setAttribute('data-original-text', 'Fixed');
                    triggerBtn.textContent = saved;
                    container.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
                    triggerBtn.classList.add('active');
                }
            } else {
                if (btnLabel === 'Custom') {
                    triggerBtn.setAttribute('data-original-text', 'Custom');
                    triggerBtn.textContent = saved;
                    container.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
                    triggerBtn.classList.add('active');
                }
            }
        });
    });
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
        root.addEventListener('change', (e) => {
            const slider = e.target;
            if (!slider.matches || !slider.matches('input[type="range"].custom-slider')) return;
            const container = slider.closest('[data-setting]');
            if (!container) return;
            const path = container.dataset.setting;
            const sets = loadSettings();
            setByPath(sets, path, parseInt(slider.value, 10));
            saveSettings(sets);
            applySoundscapeSettings(sets);
            if (typeof window.triggerSave === 'function') window.triggerSave();

            if (path === 'soundscape.masterVolume' && typeof window.playKeystrokeSound === 'function') {
                window.playKeystrokeSound('a');
            }
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

    // Only restart when on a typing page — never on settings or other routes
    const path = (location.pathname || '').replace(/\/+$/, '') || '/';
    const onTypingPage = path === '/' || path === '/room' || path === '/dual';
    if (onTypingPage && !isTestSessionActive() && typeof window.restartTest === 'function') {
        try { window.restartTest(); } catch (e) { /* typing DOM may not be mounted yet */ }
    }
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

// 3. Tab switch: user was on the settings tab and switched back here
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        _reapplyAllSettings();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
//  9. KEYMAP RENDER LOGIC
// ─────────────────────────────────────────────────────────────────────────────

window.keymapLayouts = {
    QWERTY: [
        [{ k: '`', s: '~' }, { k: '1', s: '!' }, { k: '2', s: '@' }, { k: '3', s: '#' }, { k: '4', s: '$' }, { k: '5', s: '%' }, { k: '6', s: '^' }, { k: '7', s: '&' }, { k: '8', s: '*' }, { k: '9', s: '(' }, { k: '0', s: ')' }, { k: '-', s: '_' }, { k: '=', s: '+' }, { k: 'Backspace', u: 2 }],
        [{ k: 'Tab', u: 1.5 }, { k: 'q' }, { k: 'w' }, { k: 'e' }, { k: 'r' }, { k: 't' }, { k: 'y' }, { k: 'u' }, { k: 'i' }, { k: 'o' }, { k: 'p' }, { k: '[', s: '{' }, { k: ']', s: '}' }, { k: '\\', s: '|', u: 1.5 }],
        [{ k: 'Caps', u: 1.75 }, { k: 'a' }, { k: 's' }, { k: 'd' }, { k: 'f' }, { k: 'g' }, { k: 'h' }, { k: 'j' }, { k: 'k' }, { k: 'l' }, { k: ';', s: ':' }, { k: '\'', s: '"' }, { k: 'Enter', u: 2.25 }],
        [{ k: 'Shift', u: 2.25 }, { k: 'z' }, { k: 'x' }, { k: 'c' }, { k: 'v' }, { k: 'b' }, { k: 'n' }, { k: 'm' }, { k: ',', s: '<' }, { k: '.', s: '>' }, { k: '/', s: '?' }, { k: 'Shift', u: 2.75 }],
        [{ k: 'Space', u: 6.25 }]
    ],
    Dvorak: [
        [{ k: '`', s: '~' }, { k: '1', s: '!' }, { k: '2', s: '@' }, { k: '3', s: '#' }, { k: '4', s: '$' }, { k: '5', s: '%' }, { k: '6', s: '^' }, { k: '7', s: '&' }, { k: '8', s: '*' }, { k: '9', s: '(' }, { k: '0', s: ')' }, { k: '[', s: '{' }, { k: ']', s: '}' }, { k: 'Backspace', u: 2 }],
        [{ k: 'Tab', u: 1.5 }, { k: '\'', s: '"' }, { k: ',', s: '<' }, { k: '.', s: '>' }, { k: 'p' }, { k: 'y' }, { k: 'f' }, { k: 'g' }, { k: 'c' }, { k: 'r' }, { k: 'l' }, { k: '/', s: '?' }, { k: '=', s: '+' }, { k: '\\', s: '|', u: 1.5 }],
        [{ k: 'Caps', u: 1.75 }, { k: 'a' }, { k: 'o' }, { k: 'e' }, { k: 'u' }, { k: 'i' }, { k: 'd' }, { k: 'h' }, { k: 't' }, { k: 'n' }, { k: 's' }, { k: '-', s: '_' }, { k: 'Enter', u: 2.25 }],
        [{ k: 'Shift', u: 2.25 }, { k: ';', s: ':' }, { k: 'q' }, { k: 'j' }, { k: 'k' }, { k: 'x' }, { k: 'b' }, { k: 'm' }, { k: 'w' }, { k: 'v' }, { k: 'z' }, { k: 'Shift', u: 2.75 }],
        [{ k: 'Space', u: 6.25 }]
    ],
    Colemak: [
        [{ k: '`', s: '~' }, { k: '1', s: '!' }, { k: '2', s: '@' }, { k: '3', s: '#' }, { k: '4', s: '$' }, { k: '5', s: '%' }, { k: '6', s: '^' }, { k: '7', s: '&' }, { k: '8', s: '*' }, { k: '9', s: '(' }, { k: '0', s: ')' }, { k: '-', s: '_' }, { k: '=', s: '+' }, { k: 'Backspace', u: 2 }],
        [{ k: 'Tab', u: 1.5 }, { k: 'q' }, { k: 'w' }, { k: 'f' }, { k: 'p' }, { k: 'g' }, { k: 'j' }, { k: 'l' }, { k: 'u' }, { k: 'y' }, { k: ';', s: ':' }, { k: '[', s: '{' }, { k: ']', s: '}' }, { k: '\\', s: '|', u: 1.5 }],
        [{ k: 'Backspace', u: 1.75 }, { k: 'a' }, { k: 'r' }, { k: 's' }, { k: 't' }, { k: 'd' }, { k: 'h' }, { k: 'n' }, { k: 'e' }, { k: 'i' }, { k: 'o' }, { k: '\'', s: '"' }, { k: 'Enter', u: 2.25 }],
        [{ k: 'Shift', u: 2.25 }, { k: 'z' }, { k: 'x' }, { k: 'c' }, { k: 'v' }, { k: 'b' }, { k: 'k' }, { k: 'm' }, { k: ',', s: '<' }, { k: '.', s: '>' }, { k: '/', s: '?' }, { k: 'Shift', u: 2.75 }],
        [{ k: 'Space', u: 6.25 }]
    ],
    AZERTY: [
        [{ k: '²', s: '' }, { k: '&', s: '1' }, { k: 'é', s: '2' }, { k: '"', s: '3' }, { k: '\'', s: '4' }, { k: '(', s: '5' }, { k: '-', s: '6' }, { k: 'è', s: '7' }, { k: '_', s: '8' }, { k: 'ç', s: '9' }, { k: 'à', s: '0' }, { k: ')', s: '°' }, { k: '=', s: '+' }, { k: 'Backspace', u: 2 }],
        [{ k: 'Tab', u: 1.5 }, { k: 'a' }, { k: 'z' }, { k: 'e' }, { k: 'r' }, { k: 't' }, { k: 'y' }, { k: 'u' }, { k: 'i' }, { k: 'o' }, { k: 'p' }, { k: '^', s: '¨' }, { k: '$', s: '£' }, { k: '*', s: 'µ', u: 1.5 }],
        [{ k: 'Caps', u: 1.75 }, { k: 'q' }, { k: 's' }, { k: 'd' }, { k: 'f' }, { k: 'g' }, { k: 'h' }, { k: 'j' }, { k: 'k' }, { k: 'l' }, { k: 'm' }, { k: 'ù', s: '%' }, { k: 'Enter', u: 2.25 }],
        [{ k: 'Shift', u: 2.25 }, { k: 'w' }, { k: 'x' }, { k: 'c' }, { k: 'v' }, { k: 'b' }, { k: 'n' }, { k: ',', s: '?' }, { k: ';', s: '.' }, { k: ':', s: '/' }, { k: '!', s: '§' }, { k: 'Shift', u: 2.75 }],
        [{ k: 'Space', u: 6.25 }]
    ],
    Workman: [
        [{ k: '`', s: '~' }, { k: '1', s: '!' }, { k: '2', s: '@' }, { k: '3', s: '#' }, { k: '4', s: '$' }, { k: '5', s: '%' }, { k: '6', s: '^' }, { k: '7', s: '&' }, { k: '8', s: '*' }, { k: '9', s: '(' }, { k: '0', s: ')' }, { k: '-', s: '_' }, { k: '=', s: '+' }, { k: 'Backspace', u: 2 }],
        [{ k: 'Tab', u: 1.5 }, { k: 'q' }, { k: 'd' }, { k: 'r' }, { k: 'w' }, { k: 'b' }, { k: 'j' }, { k: 'f' }, { k: 'u' }, { k: 'p' }, { k: ';', s: ':' }, { k: '[', s: '{' }, { k: ']', s: '}' }, { k: '\\', s: '|', u: 1.5 }],
        [{ k: 'Caps', u: 1.75 }, { k: 'a' }, { k: 's' }, { k: 'h' }, { k: 't' }, { k: 'g' }, { k: 'y' }, { k: 'n' }, { k: 'e' }, { k: 'o' }, { k: 'i' }, { k: '\'', s: '"' }, { k: 'Enter', u: 2.25 }],
        [{ k: 'Shift', u: 2.25 }, { k: 'z' }, { k: 'x' }, { k: 'm' }, { k: 'c' }, { k: 'v' }, { k: 'k' }, { k: 'l' }, { k: ',', s: '<' }, { k: '.', s: '>' }, { k: '/', s: '?' }, { k: 'Shift', u: 2.75 }],
        [{ k: 'Space', u: 6.25 }]
    ]
};

window.renderKeymap = function (useNumbers = true, usePunctuation = true) {
    const settings = loadSettings();
    const kl = settings.keyboardLayout || {};
    let layout = kl.keymapLayout || 'QWERTY';
    let legend = kl.keymapLegend || 'Lowercase';
    let mode = kl.keymapMode || 'Off';

    const containers = document.querySelectorAll('#dynamic-keymap');
    if (containers.length === 0) return;

    // In settings view, if we're tweaking it, show it. In test view, if Off, hide it.
    // The container might be handled differently in index.html vs settings.html
    // We'll let the parent hide the container in index.html, but renderKeymap handles drawing.

    const layoutData = window.keymapLayouts[layout] || window.keymapLayouts['QWERTY'];

    let html = '';

    const isPunctuationKey = (k, s) => {
        const puncChars = '`~-_=+\\[]{}|;\':",./<>?'.split('');
        return puncChars.includes(k) || (s && puncChars.includes(s));
    };
    const isNumberKey = (k, s) => {
        const numChars = '0123456789'.split('');
        return numChars.includes(k) || (s && numChars.includes(s));
    };

    layoutData.forEach((row, rowIndex) => {
        // Pre-check if row has ANY visible keys
        let rowHasVisibleKeys = false;
        row.forEach(keyObj => {
            let k = keyObj.k;
            let s = keyObj.s || '';
            let isLetter = k.length === 1 && /^[a-zA-Z]$/i.test(k);

            let isVisible = true;
            if (usePunctuation) {
                isVisible = true; // Full keyboard
            } else if (useNumbers) {
                isVisible = isLetter || isNumberKey(k, s) || k === 'Space' || k === 'Backspace';
            } else {
                isVisible = isLetter || k === 'Space';
            }
            if (isVisible) rowHasVisibleKeys = true;
        });

        // Skip completely empty rows to ensure perfect centering
        if (!rowHasVisibleKeys) return;

        html += '<div class="flex gap-[6px] w-full justify-center min-w-max">';
        row.forEach(keyObj => {
            let u = keyObj.u || 1;
            let widthPx = u * 32 + (u - 1) * 6; // Base key size is 32px, gap is 6px
            let keyText = keyObj.k;
            let shiftText = keyObj.s || '';
            let isModifier = keyText.length > 1 && keyText !== 'Space';

            // Check visibility requirement
            let isLetter = keyText.length === 1 && /^[a-zA-Z]$/i.test(keyText);
            let isVisible = true;

            if (usePunctuation) {
                isVisible = true; // Full keyboard
            } else if (useNumbers) {
                isVisible = isLetter || isNumberKey(keyText, shiftText) || keyText === 'Space' || keyText === 'Backspace';
            } else {
                isVisible = isLetter || keyText === 'Space';
            }

            if (!isModifier && keyText !== 'Space') {
                if (legend === 'Uppercase') {
                    keyText = keyText.toUpperCase();
                } else if (legend === 'Lowercase' || legend === 'Dynamic') {
                    keyText = keyText.toLowerCase();
                } else if (legend === 'Blank') {
                    keyText = '';
                    shiftText = '';
                }
            } else if (keyText === 'Space') {
                keyText = '';
            }

            const visibilityClass = isVisible ? '' : 'hidden';

            // Add data-chars attribute containing both normal and shifted chars
            const safeK = (keyObj.k || '').replace(/"/g, '&quot;');
            const safeS = (keyObj.s || '').replace(/"/g, '&quot;');
            let dataAttr = `data-chars="${safeK}${safeS}"`;
            if (isModifier || keyObj.k === 'Space') {
                dataAttr = `data-special="${safeK}"`;
            }

            if (isModifier || keyObj.k === 'Space') {
                html += `<div ${dataAttr} style="width: ${widthPx}px" class="keymap-key ${visibilityClass} h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary transition-all duration-75">${keyText}</div>`;
            } else if (shiftText && isVisible) {
                html += `<div ${dataAttr} style="width: ${widthPx}px" class="keymap-key ${visibilityClass} h-8 rounded-lg bg-primary/10 border border-primary/20 flex flex-col items-start justify-between p-1 pt-0.5 text-[8.5px] font-semibold text-primary/60 transition-all duration-75 relative">
                     <span class="keymap-shift-text">${shiftText}</span>
                     <span class="keymap-main-text text-[10.5px] text-primary leading-none ml-[1px] mb-[1px]">${keyText}</span>
                 </div>`;
            } else {
                html += `<div ${dataAttr} style="width: ${widthPx}px" class="keymap-key ${visibilityClass} h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary transition-all duration-75 relative"><span class="keymap-main-text">${keyText}</span></div>`;
            }
        });
        html += '</div>';
    });

    containers.forEach(c => c.innerHTML = html);
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
        /* Force glass-card style popover — matches menu bar glassmorphism */
        .custom-popover {
            background: rgba(255, 255, 255, 0.03) !important;
            backdrop-filter: blur(12px) !important;
            -webkit-backdrop-filter: blur(12px) !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1),
                        0 8px 32px rgba(0, 0, 0, 0.2) !important;
            /* Open to the RIGHT of the button, not below */
            top: 50% !important;
            left: 100% !important;
            right: auto !important;
            bottom: auto !important;
            transform: translateY(-50%) !important;
            margin-top: 0 !important;
            margin-left: 8px !important;
        }

        /* Glass-style input — subtle translucent look */
        .custom-popover input {
            background: rgba(0, 0, 0, 0.20) !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            color: #fff !important;
            -moz-appearance: textfield !important;
            appearance: textfield !important;
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
            background: rgba(255, 255, 255, 0.03) !important;
            border: 1px solid rgba(255, 255, 255, 0.05) !important;
            color: #fff !important;
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

    let finalVal = isFlex ? 'Flex:' + val : val;

    const settings = loadSettings();
    setByPath(settings, path, finalVal);
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
                optBtn.setAttribute('data-original-text', optBtn.textContent.trim());
            }
            // Show the custom number on the button
            optBtn.textContent = val;
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
    applyAllSettings,
    applyKeymapDisplay,
    refreshActiveTestVisuals,
    reapplyAllSettings: _reapplyAllSettings,
    toggleFooterMute,
    selectColorTheme,
    maybeRandomizeTheme,
    resolveThemePalette,
    getThemeDisplayName,
    isThemeLight,
    isCustomThemeName,
    syncCustomThemeEditor,
    commitCustomTheme,
    getLanguageDisplayName,
    isDualPage,
    isRoomPage,
    getEffectiveTapeMode,
};
