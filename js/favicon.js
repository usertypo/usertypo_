/**
 * Theme-aware favicon: "USER" (accent) + pixel "o" (fixed coral) + underscore (accent) on theme bg.
 * Layout matches the compact usertypo_ mark (USER centered above o_).
 * Call window.usertypoUpdateFavicon(bgHex, accentHex) whenever the theme changes.
 *
 * Static crawlable fallbacks (for Google SERP + no-JS) live in index.html as
 * /logo-assets/favicon-abyss.png and favicon-paper.png — keep those in sync via
 * scripts/generate-favicons.py when this paint logic changes.
 */
(function () {
    var SIZE = 64;
    var O_SRC = '/logo-assets/favicon-o.png';
    var USER_SRC = '/logo-assets/user.png';
    var O_COLOR = '#ff5757';
    var oImg = null;
    var userImg = null;
    var oReady = false;
    var userReady = false;
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

    /** Drop crawlable static icons once the live theme favicon is painted. Googlebot reads the HTML source (still has Abyss) and does not run this. */
    function removeStaticFavicons() {
        if (!document.head) return;
        var nodes = document.head.querySelectorAll('link[data-usertypo-static-favicon]');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id === 'usertypo-favicon') continue;
            nodes[i].parentNode.removeChild(nodes[i]);
        }
    }

    function cropToAlpha(img, callback) {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var scratch = document.createElement('canvas');
        scratch.width = w;
        scratch.height = h;
        var sctx = scratch.getContext('2d');
        if (!sctx) {
            callback(img);
            return;
        }
        sctx.drawImage(img, 0, 0);
        var data = sctx.getImageData(0, 0, w, h).data;
        var minX = w;
        var minY = h;
        var maxX = 0;
        var maxY = 0;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var a = data[(y * w + x) * 4 + 3];
                if (a <= 8) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX) {
            callback(img);
            return;
        }
        var cw = maxX - minX + 1;
        var ch = maxY - minY + 1;
        var out = document.createElement('canvas');
        out.width = cw;
        out.height = ch;
        var octx = out.getContext('2d');
        if (!octx) {
            callback(img);
            return;
        }
        octx.drawImage(img, minX, minY, cw, ch, 0, 0, cw, ch);
        var cropped = new Image();
        cropped.onload = function () {
            callback(cropped);
        };
        cropped.src = out.toDataURL('image/png');
    }

    /** Layout constants derived from the 1024px reference mark. */
    function layout(size) {
        var s = size / 1024;
        var userW = 474 * s;
        var userH = 108 * s;
        var stackGap = 29 * s;
        var oSize = 155 * s;
        var oGap = 15 * s;
        var caretW = 240 * s;
        var caretH = 49 * s;
        var belowGap = 48 * s;
        var oRowW = oSize + oGap + caretW;
        var oRowH = oSize + belowGap + caretH;
        var stackH = userH + stackGap + oRowH;
        var stackTop = (size - stackH) / 2;
        return {
            userX: (size - userW) / 2,
            userY: stackTop,
            userW: userW,
            userH: userH,
            oX: (size - oRowW) / 2,
            oY: stackTop + userH + stackGap,
            oSize: oSize,
            oGap: oGap,
            caretW: caretW,
            caretH: caretH,
            belowGap: belowGap
        };
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

    function drawTintedMask(ctx, img, x, y, w, h, color, shadowColor, shadowBlur) {
        var off = document.createElement('canvas');
        off.width = Math.max(1, Math.ceil(w));
        off.height = Math.max(1, Math.ceil(h));
        var octx = off.getContext('2d');
        if (!octx) return;
        octx.imageSmoothingEnabled = false;
        octx.drawImage(img, 0, 0, off.width, off.height);
        octx.globalCompositeOperation = 'source-in';
        octx.fillStyle = color;
        octx.fillRect(0, 0, off.width, off.height);

        ctx.save();
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = shadowBlur;
        ctx.drawImage(off, x, y, w, h);
        ctx.shadowBlur = Math.max(2, shadowBlur * 0.45);
        ctx.drawImage(off, x, y, w, h);
        ctx.restore();
        ctx.drawImage(off, x, y, w, h);
    }

    function drawO(ctx, x, y, oSize) {
        ctx.save();
        ctx.shadowColor = 'rgba(255, 51, 68, 0.9)';
        ctx.shadowBlur = Math.max(4, oSize * 0.45);
        if (oReady && oImg) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(oImg, x, y, oSize, oSize);
        } else {
            drawPixelO(ctx, x, y, oSize, O_COLOR);
        }
        ctx.shadowBlur = Math.max(2, oSize * 0.18);
        ctx.shadowColor = '#ff3344';
        if (oReady && oImg) {
            ctx.drawImage(oImg, x, y, oSize, oSize);
        } else {
            drawPixelO(ctx, x, y, oSize, O_COLOR);
        }
        ctx.restore();

        if (oReady && oImg) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(oImg, x, y, oSize, oSize);
        } else {
            drawPixelO(ctx, x, y, oSize, O_COLOR);
        }
    }

    function drawUnderscore(ctx, x, y, w, h, accent) {
        ctx.save();
        ctx.shadowColor = accent;
        ctx.shadowBlur = Math.max(4, h * 1.8);
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, w, h);
        ctx.shadowBlur = Math.max(2, h * 0.75);
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, w, h);
    }

    function paint(bg, accent) {
        lastBg = bg || lastBg;
        lastAccent = accent || lastAccent;

        var canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = lastBg;
        ctx.fillRect(0, 0, SIZE, SIZE);

        var L = layout(SIZE);

        if (userReady && userImg) {
            drawTintedMask(
                ctx,
                userImg,
                L.userX,
                L.userY,
                L.userW,
                L.userH,
                lastAccent,
                lastAccent,
                Math.max(4, L.userH * 0.55)
            );
        }

        drawO(ctx, L.oX, L.oY, L.oSize);

        drawUnderscore(
            ctx,
            Math.round(L.oX + L.oSize + L.oGap),
            Math.round(L.oY + L.oSize + L.belowGap),
            Math.round(L.caretW),
            Math.max(2, Math.round(L.caretH)),
            lastAccent
        );

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
        if (!oImg) {
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
        if (!userImg) {
            userImg = new Image();
            userImg.decoding = 'async';
            userImg.onload = function () {
                cropToAlpha(userImg, function (cropped) {
                    userImg = cropped;
                    userReady = true;
                    paint(lastBg, lastAccent);
                });
            };
            userImg.onerror = function () {
                userReady = false;
            };
            userImg.src = USER_SRC;
        }
    }

    /**
     * @param {string} bgHex       Theme background (--theme-bg)
     * @param {string} accentHex   Theme accent for USER + caret (--theme-primary)
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
