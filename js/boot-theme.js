/**
 * Blocking early theme boot — runs before CSS paints.
 * Always starts with Abyss (dark OS) / Paper (light OS) so the site never
 * flashes the classic usertypo_ cyan/blue (or any saved theme) before
 * settings.js applies the user's real palette.
 * Keep Abyss/Paper palette keys in sync with settings.js THEME_PALETTES.
 */
(function () {
    var ABYSS = {
        bgMain: '#000000',
        bgSecondary: '#444444',
        textPrimary: '#cccccc',
        textMuted: '#777777',
        accentPrimary: '#ffffff',
        accentHover: '#dddddd',
        error: '#ff4444'
    };
    var PAPER = {
        bgMain: '#f2f4f7',
        bgSecondary: '#a8b0bc',
        textPrimary: '#2a3038',
        textMuted: '#64748b',
        accentPrimary: '#1e293b',
        accentHover: '#334155',
        error: '#dc2626'
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

    // Interim only — ignore saved theme cookie / localStorage on first paint
    var name = preferredDefault();
    var p = name === 'Paper' ? PAPER : ABYSS;
    var isLight = name === 'Paper';

    var accentRGB = hexToRgb(p.accentPrimary);
    var bgSecRGB = hexToRgb(p.bgSecondary);
    var errorRGB = hexToRgb(p.error);
    var bgMainRGB = hexToRgb(p.bgMain);
    var onPrimary = isLight ? '#ffffff' : '#000000';
    var fgStrong = isLight ? '#333333' : '#ffffff';
    var ringTrack = isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.12)';

    var css = [
        ':root{',
        '--theme-primary:' + p.accentPrimary + ';',
        '--theme-primary-rgb:' + accentRGB + ';',
        '--theme-primary-hover:' + p.accentHover + ';',
        '--theme-bg:' + p.bgMain + ';',
        '--theme-bg-rgb:' + bgMainRGB + ';',
        '--theme-bg-secondary:' + p.bgSecondary + ';',
        '--theme-bg-secondary-rgb:' + bgSecRGB + ';',
        '--theme-menu-bg:rgba(' + bgSecRGB + ', 0.4);',
        '--theme-text:' + p.textPrimary + ';',
        '--theme-text-muted:' + p.textMuted + ';',
        '--theme-error:' + p.error + ';',
        '--theme-error-rgb:' + errorRGB + ';',
        '--theme-on-primary:' + onPrimary + ';',
        '--theme-fg-strong:' + fgStrong + ';',
        '--theme-ring-track:' + ringTrack + ';',
        '--theme-is-light:' + (isLight ? '1' : '0') + ';',
        '--glow-intensity:1;',
        '}',
        'html,body{background-color:var(--theme-bg) !important;}',
        '#app-backdrop,#spa-content,#spa-boot-overlay{background-color:var(--theme-bg) !important;}',
        '.text-primary{color:var(--theme-primary) !important;}',
        '.bg-primary{background-color:var(--theme-primary) !important;}',
        '.bg-background,.bg-background-dark{background-color:var(--theme-bg) !important;}',
        '.bg-surface{background-color:var(--theme-bg-secondary) !important;}',
        '#caret::after,#spa-boot-caret::after{background-color:var(--theme-primary) !important;}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'usertypo-boot-theme';
    style.textContent = css;
    document.documentElement.appendChild(style);
    document.documentElement.style.backgroundColor = p.bgMain;
    document.documentElement.setAttribute('data-theme-boot', name);

    // Shared with js/favicon.js for first-paint tab icon colors
    window.__usertypoBootPalette = {
        name: name,
        bgMain: p.bgMain,
        accentPrimary: p.accentPrimary,
        isLight: isLight
    };
})();
