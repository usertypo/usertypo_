/**
 * Theme-aware tab favicon from blah-abyss / blah-paper templates.
 * Recolors bg + USER + caret to the live theme; keeps the coral "o" static.
 * Call window.usertypoUpdateFavicon(bgHex, accentHex) whenever the theme changes.
 *
 * Built-in Abyss/Paper use the same pre-rendered PNGs as /logo-assets/favicon-*.png
 * (scripts/generate-favicons.py). Custom themes use the same zoom + circular mask.
 */
(function () {
    var SIZE = 96;
    var FAVICON_VER = 17;
    /** Keep in sync with scripts/generate-favicons.py CONTENT_ZOOM */
    var CONTENT_ZOOM = 1.06;
    var ABYSS_SRC = '/logo-assets/blah-abyss.png';
    var PAPER_SRC = '/logo-assets/blah-paper.png';
    var PRESET_ICONS = {
        abyss: { bg: '#000000', accent: '#ffffff', href: '/logo-assets/favicon-abyss.png' },
        paper: { bg: '#ffffff', accent: '#000000', href: '/logo-assets/favicon-paper.png' }
    };
    var abyssImg = null;
    var paperImg = null;
    var abyssReady = false;
    var paperReady = false;
    var lastBg = '#000000';
    var lastAccent = '#ffffff';
    var linkEl = null;

    function ensureLink() {
        if (linkEl && linkEl.parentNode) return linkEl;
        linkEl = document.getElementById('usertypo-favicon');
        if (!linkEl) {
            linkEl = document.createElement('link');
            linkEl.id = 'usertypo-favicon';
            linkEl.rel = 'icon';
            linkEl.type = 'image/png';
            if (document.head) document.head.appendChild(linkEl);
        }
        return linkEl;
    }

    function removeStaticFavicons() {
        if (!document.head) return;
        var nodes = document.head.querySelectorAll('link[data-usertypo-static-favicon]');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === 'usertypo-favicon') continue;
            nodes[i].parentNode.removeChild(nodes[i]);
        }
    }

    function normHex(hex) {
        var h = String(hex || '').replace('#', '').toLowerCase();
        if (h.length === 3) {
            h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        }
        return h.length === 6 ? '#' + h : '';
    }

    function parseHex(hex) {
        var h = normHex(hex).replace('#', '');
        if (h.length !== 6) return { r: 0, g: 0, b: 0 };
        return {
            r: parseInt(h.slice(0, 2), 16) || 0,
            g: parseInt(h.slice(2, 4), 16) || 0,
            b: parseInt(h.slice(4, 6), 16) || 0
        };
    }

    function isLightBg(hex) {
        var c = parseHex(hex);
        return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 160;
    }

    function mix(a, b, t) {
        return Math.round(a + (b - a) * t);
    }

    function presetHref(bg, accent) {
        var bgN = normHex(bg);
        var accentN = normHex(accent);
        for (var key in PRESET_ICONS) {
            if (!Object.prototype.hasOwnProperty.call(PRESET_ICONS, key)) continue;
            var preset = PRESET_ICONS[key];
            if (bgN === preset.bg && accentN === preset.accent) {
                return preset.href + '?v=' + FAVICON_VER;
            }
        }
        return null;
    }

    function applyLinkHref(href) {
        var link = ensureLink();
        if (!link || !link.parentNode) return;
        removeStaticFavicons();
        var next = link.cloneNode(false);
        next.id = 'usertypo-favicon';
        next.rel = 'icon';
        next.type = 'image/png';
        next.removeAttribute('data-usertypo-static-favicon');
        next.removeAttribute('media');
        next.href = href;
        link.parentNode.replaceChild(next, link);
        linkEl = next;
    }

    /** Coral "o" + glow — leave channel ratios intact. */
    function isRedPixel(r, g, b) {
        return r > 80 && g < 110 && b < 110 && r >= Math.max(g, b) * 1.15;
    }

    function recolorPixel(r, g, b, lightTemplate, bg, accent) {
        if (isRedPixel(r, g, b)) {
            return { r: r, g: g, b: b, a: 255 };
        }
        var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        var t = lightTemplate ? (1 - lum) : lum;
        return {
            r: mix(bg.r, accent.r, t),
            g: mix(bg.g, accent.g, t),
            b: mix(bg.b, accent.b, t),
            a: 255
        };
    }

    /** Same layout as scripts/generate-favicons.py circular_icon(). */
    function applyCircularMask(data, size) {
        var cx = size / 2;
        var cy = size / 2;
        var r = size / 2;
        var rSq = r * r;
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var dx = x + 0.5 - cx;
                var dy = y + 0.5 - cy;
                if ((dx * dx + dy * dy) > rSq) {
                    var i = (y * size + x) * 4 + 3;
                    data[i] = 0;
                }
            }
        }
    }

    function paintCustom(bg, accent, img, light) {
        var bgRgb = parseHex(bg);
        var accentRgb = parseHex(accent);
        var drawSize = Math.round(SIZE * CONTENT_ZOOM);
        var offset = (SIZE - drawSize) / 2;

        var canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, offset, offset, drawSize, drawSize);

        var imageData = ctx.getImageData(0, 0, SIZE, SIZE);
        var data = imageData.data;
        for (var i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;
            var out = recolorPixel(data[i], data[i + 1], data[i + 2], light, bgRgb, accentRgb);
            data[i] = out.r;
            data[i + 1] = out.g;
            data[i + 2] = out.b;
            data[i + 3] = out.a;
        }
        applyCircularMask(data, SIZE);
        ctx.putImageData(imageData, 0, 0);

        applyLinkHref(canvas.toDataURL('image/png'));
    }

    function paint(bg, accent) {
        lastBg = bg || lastBg;
        lastAccent = accent || lastAccent;

        var preset = presetHref(lastBg, lastAccent);
        if (preset) {
            applyLinkHref(preset);
            return;
        }

        var light = isLightBg(lastBg);
        var img = light ? paperImg : abyssImg;
        var ready = light ? paperReady : abyssReady;
        if (!ready || !img) return;

        paintCustom(lastBg, lastAccent, img, light);
    }

    function loadAssets() {
        if (!abyssImg) {
            abyssImg = new Image();
            abyssImg.decoding = 'async';
            abyssImg.onload = function () {
                abyssReady = true;
                paint(lastBg, lastAccent);
            };
            abyssImg.onerror = function () {
                abyssReady = false;
            };
            abyssImg.src = ABYSS_SRC;
        }
        if (!paperImg) {
            paperImg = new Image();
            paperImg.decoding = 'async';
            paperImg.onload = function () {
                paperReady = true;
                paint(lastBg, lastAccent);
            };
            paperImg.onerror = function () {
                paperReady = false;
            };
            paperImg.src = PAPER_SRC;
        }
    }

    /**
     * @param {string} bgHex     Theme background (--theme-bg)
     * @param {string} accentHex Theme accent for USER + caret (--theme-primary)
     */
    function updateFavicon(bgHex, accentHex) {
        paint(bgHex, accentHex);
        loadAssets();
    }

    window.usertypoUpdateFavicon = updateFavicon;

    try {
        var boot = window.__usertypoBootPalette;
        if (boot && boot.bgMain && boot.accentPrimary) {
            updateFavicon(boot.bgMain, boot.accentPrimary);
        } else {
            var cs = getComputedStyle(document.documentElement);
            var bg = (cs.getPropertyValue('--theme-bg') || '').trim() || '#000000';
            var accent = (cs.getPropertyValue('--theme-primary') || '').trim() || '#ffffff';
            updateFavicon(bg, accent);
        }
    } catch (e) {
        updateFavicon('#000000', '#ffffff');
    }
})();
