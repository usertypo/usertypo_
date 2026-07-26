/**
 * Blocking early theme boot — runs before CSS paint to prevent usertypo_ blue FOUC.
 * Keep palette keys / bgMain in sync with settings.js THEME_PALETTES.
 * Defaults: Abyss (dark OS) / Paper (light OS).
 */
(function () {
    var STORAGE_KEY = 'usertypo_settings';

    var PALETTES = {
        'usertypo_': { bgMain: '#020016', bgSecondary: '#1a1d23', textPrimary: '#e2e8f0', textMuted: '#64748b', accentPrimary: '#00d0ff', accentHover: '#33d9ff', error: '#ff3333' },
        'Minecraft': { bgMain: '#3b3328', bgSecondary: '#55493b', textPrimary: '#55ff55', textMuted: '#8b8b6a', accentPrimary: '#55d4d8', accentHover: '#7eebed', error: '#ff3333' },
        'Spider-Man': { bgMain: '#0b0c10', bgSecondary: '#454e59', textPrimary: '#e23636', textMuted: '#8892a0', accentPrimary: '#2b76c8', accentHover: '#4a90d9', error: '#ff3333' },
        'Batman': { bgMain: '#0a0a0a', bgSecondary: '#404040', textPrimary: '#c4c4c4', textMuted: '#737373', accentPrimary: '#f1c40f', accentHover: '#f4d03f', error: '#e74c3c' },
        'Iron Man': { bgMain: '#4a0e0e', bgSecondary: '#8a3131', textPrimary: '#ffffff', textMuted: '#c47a7a', accentPrimary: '#fadb5f', accentHover: '#fce588', error: '#ff3333' },
        'The Joker': { bgMain: '#1a0f2e', bgSecondary: '#4c3b73', textPrimary: '#d4c1f9', textMuted: '#8a74b8', accentPrimary: '#2ecc71', accentHover: '#58d68d', error: '#e74c3c' },
        'Superman': { bgMain: '#051b3b', bgSecondary: '#35527a', textPrimary: '#f7f7f7', textMuted: '#8aa3c8', accentPrimary: '#e23636', accentHover: '#e85c5c', error: '#ff3333' },
        'Wolverine': { bgMain: '#1a1a1a', bgSecondary: '#595959', textPrimary: '#f2ca00', textMuted: '#999966', accentPrimary: '#004b87', accentHover: '#0066b3', error: '#cc0000' },
        'Cyberpunk': { bgMain: '#0f0f12', bgSecondary: '#535a6b', textPrimary: '#e60067', textMuted: '#8b8fa3', accentPrimary: '#00ffcc', accentHover: '#33ffd6', error: '#ff3333' },
        'Matrix': { bgMain: '#000000', bgSecondary: '#003b00', textPrimary: '#00ff41', textMuted: '#267a3a', accentPrimary: '#ffffff', accentHover: '#ccffcc', error: '#ff003c' },
        'Synthwave': { bgMain: '#2b213a', bgSecondary: '#604d7c', textPrimary: '#ff9e64', textMuted: '#9a86b8', accentPrimary: '#f7768e', accentHover: '#f99aab', error: '#ff3333' },
        'Space Cadet': { bgMain: '#171a21', bgSecondary: '#4f5b66', textPrimary: '#a7adba', textMuted: '#6d7a88', accentPrimary: '#8bd49c', accentHover: '#a8e0b5', error: '#ec5f67' },
        'Matcha': { bgMain: '#f4f4f0', bgSecondary: '#c2c7b4', textPrimary: '#4d5c44', textMuted: '#8a9480', accentPrimary: '#798c6c', accentHover: '#92a585', error: '#d97373' },
        'Lavender': { bgMain: '#f5f3fa', bgSecondary: '#c8c0db', textPrimary: '#5f4b8b', textMuted: '#9486b0', accentPrimary: '#9b86cc', accentHover: '#b3a1d9', error: '#e07a5f' },
        'Oceanic': { bgMain: '#102a43', bgSecondary: '#334e68', textPrimary: '#82c0cc', textMuted: '#5a8a96', accentPrimary: '#486581', accentHover: '#627d99', error: '#ff6b6b' },
        'Campfire': { bgMain: '#2c2826', bgSecondary: '#695d56', textPrimary: '#fca311', textMuted: '#a09080', accentPrimary: '#e5e5e5', accentHover: '#ffffff', error: '#d90429' },
        'Cherry Blossom': { bgMain: '#2e1a24', bgSecondary: '#7a5061', textPrimary: '#ffb8d1', textMuted: '#b0859a', accentPrimary: '#ff5c93', accentHover: '#ff85ad', error: '#e52b50' },
        'Abyss': { bgMain: '#000000', bgSecondary: '#444444', textPrimary: '#cccccc', textMuted: '#777777', accentPrimary: '#ffffff', accentHover: '#dddddd', error: '#ff4444' },
        'Paper': { bgMain: '#ffffff', bgSecondary: '#b3b3b3', textPrimary: '#333333', textMuted: '#888888', accentPrimary: '#000000', accentHover: '#333333', error: '#cc0000' },
        'Dracula': { bgMain: '#282a36', bgSecondary: '#6272a4', textPrimary: '#f8f8f2', textMuted: '#8892a8', accentPrimary: '#bd93f9', accentHover: '#caa8fc', error: '#ff5555' }
    };

    function preferredDefault() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                return 'Paper';
            }
        } catch (e) { /* ignore */ }
        return 'Abyss';
    }

    function hexToRgb(hex) {
        var h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length !== 6) return '0, 0, 0';
        return [
            parseInt(h.slice(0, 2), 16) || 0,
            parseInt(h.slice(2, 4), 16) || 0,
            parseInt(h.slice(4, 6), 16) || 0
        ].join(', ');
    }

    function normalizeHex(value, fallback) {
        if (typeof value !== 'string') return fallback;
        var hex = value.trim();
        if (hex.charAt(0) !== '#') hex = '#' + hex;
        if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
            hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
        return hex.toLowerCase();
    }

    function customPalette(lf, name) {
        var cfg = null;
        if (typeof name === 'string' && name.indexOf('custom:') === 0) {
            var idx = parseInt(name.slice(7), 10);
            if (lf && Array.isArray(lf.customPresets) && lf.customPresets[idx]) {
                cfg = lf.customPresets[idx];
            }
        }
        if (!cfg && lf) cfg = lf.customTheme;
        if (!cfg) return PALETTES[preferredDefault()];

        var light = String(cfg.mode || '').toLowerCase() === 'light';
        var bgFallback = light ? '#ffffff' : '#000000';
        var accentFallback = light ? '#000000' : '#ffffff';
        var textFallback = light ? '#333333' : '#cccccc';
        return {
            bgMain: normalizeHex(cfg.bgColor, bgFallback),
            bgSecondary: light ? '#b3b3b3' : '#444444',
            textPrimary: normalizeHex(cfg.secondaryColor, textFallback),
            textMuted: light ? '#888888' : '#777777',
            accentPrimary: normalizeHex(cfg.mainColor, accentFallback),
            accentHover: normalizeHex(cfg.mainColor, accentFallback),
            error: light ? '#cc0000' : '#ff4444'
        };
    }

    function resolvePalette() {
        var themeName = preferredDefault();
        var lf = null;
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                lf = parsed && parsed.lookFeel;
                if (lf && lf.colorTheme) themeName = lf.colorTheme;
            }
        } catch (e) { /* corrupt — keep OS default */ }

        if (themeName === 'custom' || (typeof themeName === 'string' && themeName.indexOf('custom:') === 0)) {
            return customPalette(lf, themeName);
        }
        return PALETTES[themeName] || PALETTES[preferredDefault()];
    }

    var p = resolvePalette();
    var css = [
        ':root{',
        '--theme-primary:' + p.accentPrimary + ';',
        '--theme-primary-rgb:' + hexToRgb(p.accentPrimary) + ';',
        '--theme-primary-hover:' + p.accentHover + ';',
        '--theme-bg:' + p.bgMain + ';',
        '--theme-bg-secondary:' + p.bgSecondary + ';',
        '--theme-bg-secondary-rgb:' + hexToRgb(p.bgSecondary) + ';',
        '--theme-text:' + p.textPrimary + ';',
        '--theme-text-muted:' + p.textMuted + ';',
        '--theme-error:' + p.error + ';',
        '--theme-error-rgb:' + hexToRgb(p.error) + ';',
        '}',
        'html,body{background-color:' + p.bgMain + ' !important;}',
        '#app-backdrop,#spa-content{background-color:var(--theme-bg) !important;}',
        '.text-primary{color:var(--theme-primary) !important;}',
        '#caret::after,#spa-boot-caret::after{background-color:var(--theme-primary) !important;}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'usertypo-boot-theme';
    style.textContent = css;
    document.documentElement.appendChild(style);
    document.documentElement.style.backgroundColor = p.bgMain;
})();
