/**
 * Theme-aware tab favicon from blah-abyss / blah-paper templates.
 * Recolors bg + USER + caret to the live theme; keeps the coral "o" static.
 * Call window.usertypoUpdateFavicon(bgHex, accentHex) whenever the theme changes.
 *
 * Crawlable PNGs for Google (Abyss/Paper defaults) come from scripts/generate-favicons.py.
 */
(function () {
    var SIZE = 96;
    var WORK_SIZE = 192;
    /** Zoom into blah template — trims built-in padding around USER/o_. */
    var CONTENT_ZOOM = 1.3;
    var ABYSS_SRC = '/logo-assets/blah-abyss.png';
    var PAPER_SRC = '/logo-assets/blah-paper.png';
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

    function parseHex(hex) {
        var h = String(hex || '').replace('#', '');
        if (h.length === 3) {
            h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        }
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

    /** Coral "o" + glow — leave channel ratios intact. */
    function isRedPixel(r, g, b) {
        return r > 80 && g < 110 && b < 110 && r >= Math.max(g, b) * 1.15;
    }

    function recolorPixel(r, g, b, lightTemplate, bg, accent) {
        if (isRedPixel(r, g, b)) {
            return { r: r, g: g, b: b, a: 255 };
        }
        var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // Dark template: black bg → white fg. Light template: white bg → black fg.
        var t = lightTemplate ? (1 - lum) : lum;
        return {
            r: mix(bg.r, accent.r, t),
            g: mix(bg.g, accent.g, t),
            b: mix(bg.b, accent.b, t),
            a: 255
        };
    }

    function paint(bg, accent) {
        lastBg = bg || lastBg;
        lastAccent = accent || lastAccent;

        var light = isLightBg(lastBg);
        var img = light ? paperImg : abyssImg;
        var ready = light ? paperReady : abyssReady;
        if (!ready || !img) return;

        var bgRgb = parseHex(lastBg);
        var accentRgb = parseHex(lastAccent);

        var work = document.createElement('canvas');
        work.width = WORK_SIZE;
        work.height = WORK_SIZE;
        var wctx = work.getContext('2d');
        if (!wctx) return;

        wctx.imageSmoothingEnabled = true;
        wctx.imageSmoothingQuality = 'high';
        var drawSize = WORK_SIZE * CONTENT_ZOOM;
        var offset = (WORK_SIZE - drawSize) / 2;
        wctx.drawImage(img, offset, offset, drawSize, drawSize);

        var imageData = wctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
        var data = imageData.data;
        for (var i = 0; i < data.length; i += 4) {
            var out = recolorPixel(data[i], data[i + 1], data[i + 2], light, bgRgb, accentRgb);
            data[i] = out.r;
            data[i + 1] = out.g;
            data[i + 2] = out.b;
            data[i + 3] = out.a;
        }
        wctx.putImageData(imageData, 0, 0);

        var canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.save();
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(work, 0, 0, SIZE, SIZE);
        ctx.restore();

        var link = ensureLink();
        if (!link || !link.parentNode) return;
        removeStaticFavicons();
        var next = link.cloneNode(false);
        next.id = 'usertypo-favicon';
        next.rel = 'icon';
        next.type = 'image/png';
        next.removeAttribute('data-usertypo-static-favicon');
        next.removeAttribute('media');
        next.href = canvas.toDataURL('image/png');
        link.parentNode.replaceChild(next, link);
        linkEl = next;
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
