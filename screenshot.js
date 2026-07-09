/**
 * Stats-view screenshot utility — freeze-frame capture via modern-screenshot.
 * The live page is never restyled; only the internal render clone is patched.
 */
(function (global) {
    'use strict';

    const DEFAULT_PADDING = 56;
    const REF_ATTR = 'data-screenshot-ref';

    let iconCache = new Map();
    let refCounter = 0;

    function normalizeColor(color) {
        return (color || 'currentColor').replace(/\s/g, '');
    }

    function materialIconKey(name, size, color) {
        return `${name}|${size}|${normalizeColor(color)}`;
    }

    function toIconifyName(iconName) {
        return iconName.trim().replace(/_/g, '-');
    }

    async function fetchMaterialIconDataUrl(iconName, size, color) {
        const iconifyName = toIconifyName(iconName);
        const px = Math.max(12, Math.round(size));
        const urls = [
            `https://api.iconify.design/material-symbols/${iconifyName}.svg?width=${px}&height=${px}&color=${encodeURIComponent(color)}`,
            `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/${iconName}/default/${px}px.svg`,
        ];

        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (!res.ok) continue;
                let svg = await res.text();
                if (url.includes('fonts.gstatic.com')) {
                    const fill = color && color !== 'currentColor' ? color : '#ffffff';
                    svg = svg
                        .replace(/fill="#000000"/gi, `fill="${fill}"`)
                        .replace(/fill="#000"/gi, `fill="${fill}"`)
                        .replace(/fill="currentColor"/gi, `fill="${fill}"`);
                }
                const blob = new Blob([svg], { type: 'image/svg+xml' });
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (_) {
                /* try next source */
            }
        }
        return null;
    }

    async function preloadMaterialIcons(root, pixelScale) {
        const icons = root.querySelectorAll('.material-symbols-outlined');
        const pending = [];
        const dpr = pixelScale || Math.min(window.devicePixelRatio || 1, 2);

        icons.forEach((el) => {
            const name = el.textContent?.trim();
            if (!name) return;
            const cs = getComputedStyle(el);
            const size = parseFloat(cs.fontSize) || 24;
            const color = cs.color || '#ffffff';
            const key = materialIconKey(name, size, color);
            if (iconCache.has(key)) return;

            pending.push(
                fetchMaterialIconDataUrl(name, size * dpr, color).then((dataUrl) => {
                    if (dataUrl) iconCache.set(key, dataUrl);
                })
            );
        });

        await Promise.all(pending);
    }

    function inlineMaterialIcon(cloned, original) {
        if (!original.classList?.contains('material-symbols-outlined')) return;

        const name = original.textContent?.trim();
        if (!name) return;

        const cs = getComputedStyle(original);
        const size = parseFloat(cs.fontSize) || 24;
        const color = cs.color || '#ffffff';
        const dataUrl = iconCache.get(materialIconKey(name, size, color));
        if (!dataUrl) {
            cloned.textContent = '';
            return;
        }

        const doc = cloned.ownerDocument || document;
        const img = doc.createElement('img');
        img.src = dataUrl;
        img.alt = '';
        img.setAttribute('data-screenshot-icon', name);
        img.style.width = cs.fontSize;
        img.style.height = cs.fontSize;
        img.style.minWidth = cs.fontSize;
        img.style.minHeight = cs.fontSize;
        img.style.display = cs.display === 'block' ? 'block' : 'inline-block';
        img.style.verticalAlign = cs.verticalAlign || 'middle';
        img.style.margin = cs.margin;
        img.style.flexShrink = '0';
        if (cs.textShadow && cs.textShadow !== 'none') {
            img.style.filter = 'drop-shadow(0 0 4px rgba(255,255,255,0.35))';
        }

        cloned.textContent = '';
        cloned.className = cloned.className
            .replace(/\bmaterial-symbols-outlined\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        cloned.style.fontFamily = '';
        cloned.style.fontSize = '0';
        cloned.style.lineHeight = '0';
        cloned.style.letterSpacing = '0';
        cloned.style.width = cs.width !== 'auto' ? cs.width : cs.fontSize;
        cloned.style.height = cs.height !== 'auto' ? cs.height : cs.fontSize;
        cloned.style.display = cs.display;
        cloned.style.margin = cs.margin;
        cloned.style.padding = cs.padding;
        cloned.style.textAlign = cs.textAlign;
        cloned.appendChild(img);
    }

    function getRenderer() {
        return global.modernScreenshot || null;
    }

    function getThemeBackgroundColor() {
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim();
        if (bg) return bg;
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        return bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#121418';
    }

    function getThemeColors() {
        const root = getComputedStyle(document.documentElement);
        return {
            primary: root.getPropertyValue('--theme-primary').trim() || '#00d0ff',
            text: root.getPropertyValue('--theme-text').trim() || '#ffffff',
        };
    }

    function isGlowBackdrop(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.hasAttribute('data-screenshot-glow')) return true;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const pos = cs.position;
        if (pos !== 'absolute' && pos !== 'fixed') return false;
        const cls = el.className?.toString?.() || '';
        if (/\bblur-/.test(cls)) return true;
        if (cs.filter && cs.filter !== 'none' && cs.filter.includes('blur')) return true;
        if (cs.backgroundImage?.includes('radial-gradient')) return true;
        return false;
    }

    function shouldIncludeNode(node, hideSelectors) {
        if (node.nodeType !== 1) return true;
        const el = /** @type {Element} */ (node);
        if (isGlowBackdrop(el)) return false;
        for (const sel of hideSelectors) {
            try {
                if (el.matches(sel) || el.closest(sel)) return false;
            } catch (_) { /* ignore invalid selectors */ }
        }
        return true;
    }

    function tagCaptureTree(root) {
        const refs = new Map();
        refCounter += 1;
        const rootId = `ss-${refCounter}-root`;
        root.setAttribute(REF_ATTR, rootId);
        refs.set(rootId, root);

        root.querySelectorAll('*').forEach((el, i) => {
            const id = `ss-${refCounter}-${i}`;
            el.setAttribute(REF_ATTR, id);
            refs.set(id, el);
        });
        return refs;
    }

    function untagCaptureTree(root) {
        root.removeAttribute(REF_ATTR);
        root.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));
    }

    function resolveOriginal(cloned, refs, captureRoot) {
        const id = cloned.getAttribute?.(REF_ATTR);
        if (!id) return null;
        if (id.endsWith('-root')) return captureRoot;
        return refs.get(id) || null;
    }

    function copyResolvedInlineStyles(cloned, original) {
        const cs = getComputedStyle(original);
        const props = [
            'color', 'background', 'backgroundColor', 'backgroundImage',
            'border', 'borderColor', 'borderWidth', 'borderStyle',
            'boxShadow', 'textShadow', 'opacity', 'filter',
            'fontSize', 'fontWeight', 'fontFamily', 'lineHeight',
            'letterSpacing', 'textAlign', 'display', 'flex', 'flexDirection',
            'alignItems', 'justifyContent', 'gap', 'padding', 'margin',
            'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
            'position', 'top', 'left', 'right', 'bottom', 'transform',
            'borderRadius', 'overflow', 'gridTemplateColumns',
        ];
        props.forEach((prop) => {
            const val = cs[prop];
            if (val && val !== 'none' && val !== 'auto' && val !== 'normal') {
                try { cloned.style[prop] = val; } catch (_) { /* unsupported */ }
            }
        });
    }

    function patchClonedNode(cloned, original) {
        if (!cloned || !original || cloned.nodeType !== 1 || original.nodeType !== 1) return;

        if (isGlowBackdrop(original)) {
            cloned.style.display = 'none';
            return;
        }

        const ocs = getComputedStyle(original);
        const cls = original.className?.toString?.() || '';

        if (cls.includes('opacity-0') || (cls.includes('stats-animate-card') && parseFloat(ocs.opacity) < 0.99)) {
            cloned.style.animation = 'none';
            cloned.style.animationDelay = '0s';
            cloned.style.transition = 'none';
            cloned.style.opacity = '1';
            cloned.style.transform = 'none';
        }

        if (cls.includes('backdrop-blur') || cls.includes('glass-panel') || cls.includes('glass-card') || cls.includes('panel-surface')) {
            cloned.style.backdropFilter = 'none';
            cloned.style.webkitBackdropFilter = 'none';
            if (ocs.backgroundColor && ocs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                cloned.style.backgroundColor = ocs.backgroundColor;
            }
        }

        const inline = original.getAttribute('style') || '';
        if (inline.includes('var(')) {
            copyResolvedInlineStyles(cloned, original);
        }

        inlineMaterialIcon(cloned, original);
    }

    const WATERMARK = {
        cornerPad: 18,
        textLift: 6,
        text: 'usertypo.com',
    };

    function resolveWatermarkTextSize(canvasWidth, canvasHeight) {
        const shortSide = Math.min(canvasWidth, canvasHeight);
        return Math.max(16, Math.round(shortSide * 0.022));
    }

    async function addWatermark(sourceCanvas) {
        const canvas = document.createElement('canvas');
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(sourceCanvas, 0, 0);

        const colors = getThemeColors();
        const textSize = resolveWatermarkTextSize(canvas.width, canvas.height);
        const anchorRight = canvas.width - WATERMARK.cornerPad;
        const anchorBottom = canvas.height - WATERMARK.cornerPad;
        const textBaselineY = anchorBottom - WATERMARK.textLift;

        ctx.font = `600 ${textSize}px Inter, sans-serif`;
        ctx.fillStyle = colors.text;
        ctx.globalAlpha = 0.9;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(WATERMARK.text, anchorRight, textBaselineY);
        ctx.globalAlpha = 1;

        return canvas;
    }

    function addPadding(sourceCanvas, paddingPx, bgColor) {
        const canvas = document.createElement('canvas');
        canvas.width = sourceCanvas.width + paddingPx * 2;
        canvas.height = sourceCanvas.height + paddingPx * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sourceCanvas, paddingPx, paddingPx);
        return canvas;
    }

    async function copyOrDownloadBlob(blob) {
        try {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            return 'clipboard';
        } catch (_) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'usertypo-stats.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            return 'download';
        }
    }

    async function captureStatsScreenshot(options) {
        const {
            captureArea,
            button,
            hideSelectors = [],
            scale,
            padding = DEFAULT_PADDING,
            patchCloneRoot,
            beforeCapture,
            afterCapture,
        } = options;

        const ms = getRenderer();
        if (!captureArea) {
            console.error('Screenshot failed: capture area not found');
            return false;
        }
        if (!ms?.domToCanvas) {
            console.error('Screenshot failed: modern-screenshot not loaded');
            return false;
        }

        const btn = button || null;
        const originalBtnHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<span class="material-symbols-outlined text-[20px] animate-spin">refresh</span>';
            btn.disabled = true;
        }

        let refs = null;
        let rootPatched = false;
        const bgColor = getThemeBackgroundColor();
        const pixelScale = scale || Math.min(window.devicePixelRatio || 1, 2);

        try {
            if (typeof beforeCapture === 'function') {
                await beforeCapture();
            }

            const rect = captureArea.getBoundingClientRect();
            const width = Math.ceil(Math.max(captureArea.offsetWidth, captureArea.scrollWidth, rect.width));
            const height = Math.ceil(Math.max(captureArea.offsetHeight, captureArea.scrollHeight, rect.height));
            if (width < 1 || height < 1) {
                throw new Error(`Capture area has zero dimensions (${width}x${height})`);
            }

            refs = tagCaptureTree(captureArea);

            await preloadMaterialIcons(captureArea, pixelScale);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

            const rawCanvas = await ms.domToCanvas(captureArea, {
                width,
                height,
                scale: pixelScale,
                backgroundColor: bgColor,
                filter: (node) => shouldIncludeNode(node, hideSelectors),
                onCloneEachNode: (cloned) => {
                    if (cloned.nodeType !== 1 || !refs) return;
                    const original = resolveOriginal(cloned, refs, captureArea);
                    if (original) patchClonedNode(cloned, original);
                    if (!rootPatched && cloned.getAttribute(REF_ATTR)?.endsWith('-root')) {
                        rootPatched = true;
                        if (typeof patchCloneRoot === 'function') {
                            patchCloneRoot(cloned, captureArea);
                        }
                    }
                },
                font: { preferredFormat: 'woff2' },
                timeout: 30000,
            });

            const paddedCanvas = addPadding(rawCanvas, Math.round(padding * pixelScale), bgColor);
            const finalCanvas = await addWatermark(paddedCanvas);

            const blob = await new Promise((resolve, reject) => {
                finalCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
            });

            await copyOrDownloadBlob(blob);

            if (btn) {
                btn.innerHTML = '<span class="material-symbols-outlined text-[20px] text-green-400">check</span>';
                setTimeout(() => {
                    btn.innerHTML = originalBtnHtml;
                    btn.disabled = false;
                }, 2000);
            }
            return true;
        } catch (err) {
            console.error('Screenshot failed:', err);
            if (btn) {
                btn.innerHTML = '<span class="material-symbols-outlined text-[20px] text-red-400">close</span>';
                setTimeout(() => {
                    btn.innerHTML = originalBtnHtml;
                    btn.disabled = false;
                }, 2000);
            }
            return false;
        } finally {
            if (refs) untagCaptureTree(captureArea);
            if (typeof afterCapture === 'function') {
                afterCapture();
            }
        }
    }

    global.StatsScreenshot = {
        capture: captureStatsScreenshot,
        getThemeBackgroundColor,
    };
})(window);
