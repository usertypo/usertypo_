/**
 * Theme-aware tab favicon from pre-made marks in logo-assets/.
 * Dark themes → blah-abyss.png, light themes → blah-paper.png (circular clip).
 * Call window.usertypoUpdateFavicon(bgHex) whenever the theme changes.
 *
 * Crawlable PNGs for Google are generated from the same sources via
 * scripts/generate-favicons.py → favicon-abyss.png / favicon-paper.png.
 */
(function () {
    var SIZE = 64;
    var ABYSS_SRC = '/logo-assets/blah-abyss.png';
    var PAPER_SRC = '/logo-assets/blah-paper.png';
    var abyssImg = null;
    var paperImg = null;
    var abyssReady = false;
    var paperReady = false;
    var lastBg = '#000000';
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

    function isLightBg(hex) {
        var h = String(hex || '').replace('#', '');
        if (h.length === 3) {
            h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        }
        if (h.length !== 6) return false;
        var r = parseInt(h.slice(0, 2), 16) || 0;
        var g = parseInt(h.slice(2, 4), 16) || 0;
        var b = parseInt(h.slice(4, 6), 16) || 0;
        return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
    }

    function paint(bg) {
        lastBg = bg || lastBg;
        var light = isLightBg(lastBg);
        var img = light ? paperImg : abyssImg;
        var ready = light ? paperReady : abyssReady;
        if (!ready || !img) return;

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
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
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
                paint(lastBg);
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
                paint(lastBg);
            };
            paperImg.onerror = function () {
                paperReady = false;
            };
            paperImg.src = PAPER_SRC;
        }
    }

    /**
     * @param {string} bgHex Theme background (--theme-bg); picks Abyss vs Paper mark.
     * @param {string} [_accentHex] Unused — marks are pre-rendered.
     */
    function updateFavicon(bgHex, _accentHex) {
        paint(bgHex);
        loadAssets();
    }

    window.usertypoUpdateFavicon = updateFavicon;

    try {
        var boot = window.__usertypoBootPalette;
        if (boot && boot.bgMain) {
            updateFavicon(boot.bgMain);
        } else {
            var cs = getComputedStyle(document.documentElement);
            var bg = (cs.getPropertyValue('--theme-bg') || '').trim() || '#000000';
            updateFavicon(bg);
        }
    } catch (e) {
        updateFavicon('#000000');
    }
})();
