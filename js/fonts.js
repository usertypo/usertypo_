/**
 * On-demand Google Fonts loader for optional typing typefaces.
 * Critical UI fonts (Inter, Space Grotesk, JetBrains Mono, Roboto Mono,
 * Material Symbols) are loaded from the document <head>.
 */
(function (global) {
    'use strict';

    var FAMILY_QUERY = {
        'Cutive': 'family=Cutive',
        'Cutive Mono': 'family=Cutive+Mono',
        'Kode Mono': 'family=Kode+Mono:wght@400;700',
        'Roboto': 'family=Roboto:wght@400;500;700',
        'SUSE': 'family=SUSE:wght@400;700',
        'SUSE Mono': 'family=SUSE+Mono:wght@400;700',
        'Ubuntu': 'family=Ubuntu:wght@400;500;700',
        'Ubuntu Sans Mono': 'family=Ubuntu+Sans+Mono:wght@400;700',
        'Xanh Mono': 'family=Xanh+Mono',
    };

    var CRITICAL = {
        'Inter': 1,
        'Space Grotesk': 1,
        'JetBrains Mono': 1,
        'Roboto Mono': 1,
        'Material Symbols Outlined': 1,
    };

    var loaded = Object.create(null);
    Object.keys(CRITICAL).forEach(function (name) { loaded[name] = true; });

    function ensureFontLoaded(family) {
        var name = String(family || '').trim();
        if (!name || loaded[name] || CRITICAL[name]) {
            loaded[name] = true;
            return;
        }
        var query = FAMILY_QUERY[name];
        if (!query) {
            loaded[name] = true;
            return;
        }
        loaded[name] = true;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?' + query + '&display=swap';
        link.media = 'print';
        link.onload = function () { link.media = 'all'; };
        (document.head || document.documentElement).appendChild(link);
        // Fallback if onload never fires
        setTimeout(function () { link.media = 'all'; }, 1500);
    }

    global.usertypoEnsureFontLoaded = ensureFontLoaded;
})(window);
