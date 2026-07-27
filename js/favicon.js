/**
 * Theme-aware favicon: pixel "o" (fixed coral) + underscore caret (accent) on theme bg.
 * Circular icon; o and _ share the same width; _ sits on the o baseline (matches logo art).
 * Call window.usertypoUpdateFavicon(bgHex, accentHex) whenever the theme changes.
 */
(function () {
    var SIZE = 64;
    var O_SRC = '/logo-assets/favicon-o.png';
    var O_COLOR = '#ff5757';
    var oImg = null;
    var oReady = false;
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

    /** Fallback pixel "o" if favicon-o.png has not loaded yet. */
    function drawPixelO(ctx, x, y, size, color) {
        var grid = [
            [0, 1, 1, 1, 1, 0],
            [1, 1, 0, 0, 1, 1],
            [1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1],
            [1, 1, 0, 0, 1, 1],
            [0, 1, 1, 1, 1, 0]
        ];
        var rows = grid.length;
        var cols = grid[0].length;
        var cell = size / Math.max(rows, cols);
        var ox = x + (size - cols * cell) / 2;
        var oy = y + (size - rows * cell) / 2;
        ctx.fillStyle = color;
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                if (!grid[r][c]) continue;
                ctx.fillRect(
                    Math.round(ox + c * cell),
                    Math.round(oy + r * cell),
                    Math.ceil(cell),
                    Math.ceil(cell)
                );
            }
        }
    }

    function paint(bg, accent) {
        lastBg = bg || lastBg;
        lastAccent = accent || lastAccent;

        var canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Transparent outside → circular tab icon
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        ctx.fillStyle = lastBg;
        ctx.fillRect(0, 0, SIZE, SIZE);

        // Zoomed out so o_ sits with breathing room; glows match header logo
        var oSize = 20;
        var stroke = Math.max(3, Math.round(oSize * (6 / 32)));
        var gap = Math.max(2, Math.round(oSize * (3 / 98)));
        var caretW = oSize;
        var caretH = stroke;
        var belowGap = Math.max(2, Math.round(oSize * 0.14));
        var totalW = oSize + gap + caretW;
        var totalH = oSize + belowGap + caretH;
        var startX = Math.round((SIZE - totalW) / 2);
        var oY = Math.round((SIZE - totalH) / 2);

        // Coral glow on o (matches header-fade-o)
        ctx.save();
        ctx.shadowColor = 'rgba(255, 51, 68, 0.9)';
        ctx.shadowBlur = 10;
        if (oReady && oImg) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(oImg, startX, oY, oSize, oSize);
        } else {
            drawPixelO(ctx, startX, oY, oSize, O_COLOR);
        }
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#ff3344';
        if (oReady && oImg) {
            ctx.drawImage(oImg, startX, oY, oSize, oSize);
        } else {
            drawPixelO(ctx, startX, oY, oSize, O_COLOR);
        }
        ctx.restore();

        // Solid o on top of glow
        if (oReady && oImg) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(oImg, startX, oY, oSize, oSize);
        } else {
            drawPixelO(ctx, startX, oY, oSize, O_COLOR);
        }

        // Underscore: same width as o, same stroke weight, below the letter + accent glow
        var caretX = startX + oSize + gap;
        var caretY = oY + oSize + belowGap;

        ctx.save();
        ctx.shadowColor = lastAccent;
        ctx.shadowBlur = 12;
        ctx.fillStyle = lastAccent;
        ctx.fillRect(caretX, caretY, caretW, caretH);
        ctx.shadowBlur = 5;
        ctx.fillRect(caretX, caretY, caretW, caretH);
        ctx.restore();

        ctx.fillStyle = lastAccent;
        ctx.fillRect(caretX, caretY, caretW, caretH);

        var link = ensureLink();
        if (!link || !link.parentNode) return;
        var next = link.cloneNode(false);
        next.id = 'usertypo-favicon';
        next.rel = 'icon';
        next.type = 'image/png';
        next.href = canvas.toDataURL('image/png');
        link.parentNode.replaceChild(next, link);
        linkEl = next;
    }

    function loadO() {
        if (oImg) return;
        oImg = new Image();
        oImg.decoding = 'async';
        oImg.onload = function () {
            oReady = true;
            paint(lastBg, lastAccent);
        };
        oImg.onerror = function () {
            oReady = false;
        };
        oImg.src = O_SRC;
    }

    /**
     * @param {string} bgHex       Theme background (--theme-bg)
     * @param {string} accentHex   Theme accent / caret (--theme-primary)
     */
    function updateFavicon(bgHex, accentHex) {
        paint(bgHex, accentHex);
        loadO();
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
