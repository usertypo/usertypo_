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
        paceCaretStyle: 'line',      // line | block | underscore | outline
        smoothLineScroll: true,
        tapeMode: 'off',       // off | letter | word
        tapeModeInRooms: 'letter', // off | letter | word — room test view only
    },
    soundscape: {
        clickSounds: false,
        errorSounds: 'beep', // Changed from boolean to string
        masterVolume: 50,
        soundPack: 'Steelseries Apex Pro V2',
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
    }
};

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

    if (settings.cursor && settings.cursor.tapeModeInRooms === undefined) {
        settings.cursor.tapeModeInRooms = 'letter';
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

/**
 * Derive lighter / darker shades from a hex color.
 */
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
    const p = THEME_PALETTES[themeName] || THEME_PALETTES['usertypo_'];

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

    // Logo colors: typ_ uses accent, user uses textPrimary, o stays red
    const logoTypColor = accentLight; // typ_ layer
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
        html { background-color: ${p.bgMain} !important; }
        body { color: ${p.textMuted}; }
        [style*="background-color: #020016"],
        [style*="background:#020016"],
        .fixed.inset-0.z-0,
        div[style*="background-color"][style*="020016"] { background-color: ${p.bgMain} !important; }
        /* Radial glow overlay */
        div[style*="radial-gradient"] { background: radial-gradient(ellipse 70% 55% at 50% 38%, rgba(${accentRGB}, 0.05) 0%, transparent 72%) !important; }

        /* ── Glass panels ── */
        .glass-panel {
            background: linear-gradient(145deg, rgba(${bgSecRGB}, 0.4) 0%, rgba(${bgSecRGB}, 0.2) 100%) !important;
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

        /* ── Settings page: info popovers ── */
        .info-popover { border-color: rgba(${accentRGB}, 0.2) !important; }

        /* ── Settings page: setting select, toggle ── */
        .setting-select { border-color: rgba(${accentRGB}, 0.25) !important; }
        .setting-select:hover { border-color: rgba(${accentRGB}, 0.5) !important; }
        .toggle-track.on { background: ${p.accentPrimary} !important; border-color: ${p.accentPrimary} !important; box-shadow: 0 0 12px rgba(${accentRGB}, 0.4) !important; }

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

        /* ── Settings page sub-setting-card ── */
        .sub-setting-card {
            border-color: rgba(${accentRGB}, 0.3) !important;
            box-shadow: 0 0 15px rgba(${accentRGB}, 0.08), inset 0 0 0 1px rgba(${accentRGB}, 0.05) !important;
            background: linear-gradient(145deg, rgba(${accentRGB}, 0.04) 0%, rgba(${bgSecRGB}, 0.3) 100%) !important;
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

        /* ── Settings select chevron SVG ── */
        .setting-select {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${p.accentPrimary.slice(1)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") !important;
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
        .player-node.is-ready .player-avatar-ring {
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
        .setting-card.active {
            border-color: rgba(${accentRGB}, 0.3) !important;
            box-shadow: 0 0 15px rgba(${accentRGB}, 0.08), inset 0 0 0 1px rgba(${accentRGB}, 0.05) !important;
            background: linear-gradient(145deg, rgba(${accentRGB}, 0.04) 0%, rgba(${bgSecRGB}, 0.3) 100%) !important;
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

function getEffectiveTapeMode(settings) {
    const cursor = settings?.cursor || {};
    if (isRoomPage()) {
        return String(cursor.tapeModeInRooms || 'letter').toLowerCase();
    }
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
    const _palette = THEME_PALETTES[_themeName] || THEME_PALETTES['usertypo_'];
    const _caretAccent = _palette.accentPrimary;
    const _caretRGB = _hexToRGB(_caretAccent);
    styleEl.textContent = buildCaretCSS(settings.cursor.caretStyle, settings.cursor.caretSmoothness, _caretAccent, _caretRGB)
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
        document.body.setAttribute('data-sound-pack', settings.soundscape.soundPack);
    }

    // Pre-load the chosen sound pack if the audio manager is available
    if (settings.soundscape.clickSounds && typeof window.loadSoundPack === 'function') {
        window.loadSoundPack(settings.soundscape.soundPack);
    }
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

/**
 * Apply keyboard layout settings.
 */
function applyKeyboardLayoutSettings(settings) {
    if (!settings) settings = loadSettings();
    if (!document.body) return;

    const kl = settings.keyboardLayout || DEFAULTS.keyboardLayout;
    document.body.setAttribute('data-quick-restart', kl.quickRestart || 'Tab');

    // Re-render keymap if function exists
    if (typeof window.renderKeymap === 'function') {
        window.renderKeymap();
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

        const caret = document.getElementById('caret');
        if (!caret) return;

        const ease = 'cubic-bezier(0.2, 0, 0.2, 1)';
        caret.style.transition = `transform ${dur}ms ${ease}, width ${dur}ms ${ease}, opacity 0.5s ease-in-out`;
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
}


// ─────────────────────────────────────────────────────────────────────────────
//  7. PERSISTENCE — hook into selectOpt / toggleSwitch
// ─────────────────────────────────────────────────────────────────────────────

function persistFromOpt(btn) {
    const path = getSettingPath(btn);
    if (!path) return;

    const settings = loadSettings();
    setByPath(settings, path, resolveOptValue(btn));
    saveSettings(settings);
    applyCursorSettings(settings);
    applySoundscapeSettings(settings);
    applyTestRulesSettings(settings);
    applyKeyboardLayoutSettings(settings);
    applyThemeSettings(settings);

    if (path.startsWith('liveFeed.') && typeof window.applyRoomLiveFeedSettings === 'function') {
        window.applyRoomLiveFeedSettings();
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
    applyCursorSettings(settings);
    applySoundscapeSettings(settings);
    applyTestRulesSettings(settings);
    applyKeyboardLayoutSettings(settings);

    if (path.startsWith('liveFeed.') && typeof window.applyRoomLiveFeedSettings === 'function') {
        window.applyRoomLiveFeedSettings();
    }

    if (path.startsWith('soundscape.') && typeof window.playKeystrokeSound === 'function') {
        if (path === 'soundscape.errorSounds') {
            if (typeof window.playErrorSound === 'function') window.playErrorSound();
        } else {
            window.playKeystrokeSound('a');
        }
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

        // Setup caret width guard for "line" style
        setupCaretWidthGuard();

        // Restore settings page UI controls
        restoreUI(settings);

        // ── Wrap selectOpt ──
        if (typeof window.selectOpt === 'function') {
            const _orig = window.selectOpt;
            window.selectOpt = function (btn) {
                _orig(btn);
                persistFromOpt(btn);
            };
        }

        // ── Wrap toggleSwitch ──
        if (typeof window.toggleSwitch === 'function') {
            const _orig = window.toggleSwitch;
            window.toggleSwitch = function (track) {
                _orig(track);
                persistFromToggle(track);
            };
        }

        // ── Bind Range Sliders ──
        document.querySelectorAll('[data-setting] input[type="range"]').forEach(slider => {
            slider.addEventListener('change', () => {
                const container = slider.closest('[data-setting]');
                if (!container) return;
                const path = container.dataset.setting;
                const sets = loadSettings();
                setByPath(sets, path, parseInt(slider.value));
                saveSettings(sets);
                applySoundscapeSettings(sets);
                if (typeof triggerSave === 'function') triggerSave();

                if (path === 'soundscape.masterVolume' && typeof window.playKeystrokeSound === 'function') {
                    window.playKeystrokeSound('a');
                }
            });
        });
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

/**
 * Central helper: reload settings from localStorage and re-apply everything.
 */
function _reapplyAllSettings() {
    const settings = loadSettings();
    applyCursorSettings(settings);
    applySoundscapeSettings(settings);
    applyTestRulesSettings(settings);
    applyKeyboardLayoutSettings(settings);
    applyThemeSettings(settings);

    // If we are on the settings page, also refresh the UI controls
    if (document.querySelectorAll('[data-setting]').length > 0) {
        restoreUI(settings);
    }

    // If we are on the index page and not currently typing, restart the test
    // so new language / test-rule settings take effect
    if (typeof restartTest === 'function' && typeof isTyping !== 'undefined' && !isTyping) {
        restartTest();
    }

    // Re-init language if the language setting changed
    if (typeof window._initLang === 'function') {
        window._initLang();
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
(function patchSelectOpt() {
    function doPatch() {
        if (typeof window.selectOpt !== 'function') return;
        const _origSelectOpt = window.selectOpt;
        window.selectOpt = function (btn) {
            // Before calling original, reset any custom buttons in this group
            const container = btn.closest('[data-setting]');
            if (container) {
                container.querySelectorAll('.opt-btn').forEach(b => {
                    if (b.hasAttribute('data-original-text')) {
                        b.textContent = b.getAttribute('data-original-text');
                        b.removeAttribute('data-original-text');
                    }
                });
            }
            _origSelectOpt(btn);
        };
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(doPatch, 100));
    } else {
        setTimeout(doPatch, 100);
    }
})();

// On page load, restore custom values on buttons from saved settings
(function restoreCustomButtonValues() {
    function doRestore() {
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

            // Check if any regular button matches
            let matchedRegular = false;
            container.querySelectorAll('.opt-btn').forEach(b => {
                if (!b.closest('.custom-popover-wrapper')) {
                    const btnText = b.textContent.trim();
                    if (btnText === String(saved)) matchedRegular = true;
                }
            });
            if (matchedRegular) return;

            // It's a custom value — find the right trigger button
            container.querySelectorAll('.custom-popover-wrapper > .opt-btn').forEach(triggerBtn => {
                const btnLabel = triggerBtn.textContent.trim();

                if (path === 'resultsAndGraphs.minBurst') {
                    if (String(saved).startsWith('Flex:') && btnLabel === 'Flex') {
                        triggerBtn.setAttribute('data-original-text', 'Flex');
                        triggerBtn.textContent = String(saved).split(':')[1];
                        // Remove active from others, set this active
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(doRestore, 200));
    } else {
        setTimeout(doRestore, 200);
    }
})();
