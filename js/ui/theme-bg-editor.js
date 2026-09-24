/**
 * Custom theme background image — picker + fullscreen pan/zoom/opacity editor.
 * Mirrors avatar-editor UX (change / edit / remove) with notifications-style glass panels.
 * Public API: window.usertypoThemeBgEditor
 */
(function () {
    var MIN_ZOOM = 1;
    var MAX_ZOOM = 3;
    var DEFAULT_OPACITY = 0.75;
    var MAX_IMPORT_BYTES = 8 * 1024 * 1024;
    var MAX_DATA_URL_CHARS = 550000; // ~400KB binary after base64
    var COMPRESS_MAX_EDGE = 1600;
    var COMPRESS_QUALITY = 0.72;

    var DEFAULT_IMAGES = [
        { id: 'aurora', name: 'Aurora', url: '/assets/theme-bgs/aurora.png' },
        { id: 'dusk', name: 'Dusk', url: '/assets/theme-bgs/dusk.png' },
        { id: 'ocean', name: 'Ocean', url: '/assets/theme-bgs/ocean.png' },
        { id: 'geometry', name: 'Geometry', url: '/assets/theme-bgs/geometry.png' },
    ];

    var els = null;
    var mode = 'closed'; // closed | menu | picker | edit
    var img = null;
    var imgUrl = '';
    var imgId = '';
    var coverScale = 1;
    var scale = 1;
    var offsetX = 0;
    var offsetY = 0;
    var opacity = DEFAULT_OPACITY;
    var dragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var originX = 0;
    var originY = 0;
    var objectUrl = null;
    var resizeObserver = null;

    function toast(message, icon) {
        if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
            window.usertypoNotifications.showToast(message, icon || 'wallpaper');
        }
    }

    function loadSettings() {
        if (window.usertypo_settingsApi && window.usertypo_settingsApi.loadSettings) {
            return window.usertypo_settingsApi.loadSettings();
        }
        return window.usertypo_settings || null;
    }

    function currentBgImage() {
        var settings = loadSettings();
        var cfg = settings && settings.lookFeel && settings.lookFeel.customTheme;
        var bg = cfg && cfg.bgImage;
        if (!bg || typeof bg !== 'object' || !bg.url) return null;
        return bg;
    }

    function hasBgImage() {
        return !!currentBgImage();
    }

    function normalizeBgImage(raw) {
        if (!raw || typeof raw !== 'object' || !raw.url) return null;
        var zoom = Number(raw.zoom);
        if (!Number.isFinite(zoom)) zoom = 1;
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        var op = Number(raw.opacity);
        if (!Number.isFinite(op)) op = DEFAULT_OPACITY;
        op = Math.max(0.05, Math.min(1, op));
        var ox = Number(raw.offsetX);
        var oy = Number(raw.offsetY);
        if (!Number.isFinite(ox)) ox = 0.5;
        if (!Number.isFinite(oy)) oy = 0.5;
        ox = Math.max(0, Math.min(1, ox));
        oy = Math.max(0, Math.min(1, oy));
        var url = String(raw.url);
        if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.normalizeDurableUrl === 'function') {
            url = window.usertypoThemeAssets.normalizeDurableUrl(url);
        }
        return {
            id: String(raw.id || 'custom'),
            url: url,
            opacity: op,
            zoom: zoom,
            offsetX: ox,
            offsetY: oy,
        };
    }

    function ensureDom() {
        if (els) return els;

        var root = document.createElement('div');
        root.id = 'theme-bg-editor-root';
        root.style.cssText = 'pointer-events:none;';
        root.innerHTML =
            '<div id="theme-bg-modal" class="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-200" aria-hidden="true" style="z-index:9999">' +
                '<div id="theme-bg-box" class="glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 rounded-3xl p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] scale-95 opacity-0 transition-all duration-200 w-[min(94vw,32rem)] relative flex flex-col gap-4">' +
                    '<button type="button" id="theme-bg-close" class="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" aria-label="Close">' +
                        '<span class="material-symbols-outlined text-[1.066rem]">close</span>' +
                    '</button>' +
                    '<div id="theme-bg-menu-view" class="hidden flex flex-col gap-3">' +
                        '<div class="text-primary font-bold text-sm flex items-center gap-2 tracking-wide pr-8">' +
                            '<span class="material-symbols-outlined text-[1.066rem]">wallpaper</span>' +
                            '<span>Background image</span>' +
                        '</div>' +
                        '<p class="text-xs text-slate-400 leading-relaxed">Change, edit, or remove your theme background.</p>' +
                        '<div class="flex flex-col gap-2 mt-1">' +
                            '<button type="button" id="theme-bg-opt-change" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 text-sm font-bold transition-colors">' +
                                '<span class="material-symbols-outlined text-[1.066rem]">add_photo_alternate</span><span>Change image</span>' +
                            '</button>' +
                            '<button type="button" id="theme-bg-opt-edit" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface/60 hover:bg-surface text-slate-200 border border-white/10 text-sm font-bold transition-colors">' +
                                '<span class="material-symbols-outlined text-[1.066rem]">crop</span><span>Edit current</span>' +
                            '</button>' +
                            '<button type="button" id="theme-bg-opt-remove" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-400/20 text-sm font-bold transition-colors">' +
                                '<span class="material-symbols-outlined text-[1.066rem]">delete</span><span>Remove image</span>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<div id="theme-bg-picker-view" class="hidden flex flex-col gap-3">' +
                        '<div class="text-primary font-bold text-sm flex items-center gap-2 tracking-wide pr-8">' +
                            '<span class="material-symbols-outlined text-[1.066rem]">wallpaper</span>' +
                            '<span>Choose background</span>' +
                        '</div>' +
                        '<p class="text-xs text-slate-400 leading-relaxed">Pick a default or import an image from your computer.</p>' +
                        '<div id="theme-bg-default-grid" class="grid grid-cols-2 gap-2.5 mt-1" style="display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;"></div>' +
                        '<button type="button" id="theme-bg-import" class="w-full flex items-center justify-center gap-2 px-4 py-3 mt-1 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 text-sm font-bold transition-colors">' +
                            '<span class="material-symbols-outlined text-[1.066rem]">upload</span><span>Import image from PC</span>' +
                        '</button>' +
                    '</div>' +
                    '<input id="theme-bg-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" />' +
                '</div>' +
            '</div>' +
            '<div id="theme-bg-edit-layer" class="fixed inset-0 pointer-events-none opacity-0 invisible transition-opacity duration-300" aria-hidden="true" style="z-index:9990">' +
                '<div id="theme-bg-edit-stage" class="absolute overflow-hidden cursor-grab touch-none select-none" style="left:0;right:0;bottom:0;top:0;background:var(--theme-bg,#000)">' +
                    '<img id="theme-bg-edit-img" alt="" draggable="false" class="absolute max-w-none pointer-events-none select-none" style="opacity:0;transition:opacity 0.3s ease;" />' +
                '</div>' +
                '<div id="theme-bg-edit-controls" class="glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] flex flex-col gap-3 pointer-events-none opacity-0 transition-opacity duration-300" style="position:absolute;left:50%;bottom:1.5rem;transform:translateX(-50%);width:min(92vw,28rem);z-index:2;box-sizing:border-box;">' +
                    '<p class="text-xs text-slate-400 text-center">Drag to move · adjust opacity and zoom</p>' +
                    '<label class="flex items-center gap-3 text-xs font-bold text-slate-300">' +
                        '<span class="material-symbols-outlined text-[0.959rem] text-primary shrink-0">opacity</span>' +
                        '<span class="w-16 shrink-0">Opacity</span>' +
                        '<input id="theme-bg-opacity" type="range" min="5" max="100" value="75" class="flex-1 accent-[rgb(var(--theme-primary-rgb))]" />' +
                        '<span id="theme-bg-opacity-val" class="w-10 text-right tabular-nums text-slate-400">75%</span>' +
                    '</label>' +
                    '<label class="flex items-center gap-3 text-xs font-bold text-slate-300">' +
                        '<span class="material-symbols-outlined text-[0.959rem] text-primary shrink-0">zoom_in</span>' +
                        '<span class="w-16 shrink-0">Zoom</span>' +
                        '<input id="theme-bg-zoom" type="range" min="100" max="300" value="100" class="flex-1 accent-[rgb(var(--theme-primary-rgb))]" />' +
                        '<span id="theme-bg-zoom-val" class="w-10 text-right tabular-nums text-slate-400">100%</span>' +
                    '</label>' +
                    '<div class="flex justify-end gap-2 mt-1">' +
                        '<button type="button" id="theme-bg-edit-cancel" class="px-4 py-2 rounded-xl text-slate-400 hover:text-white transition-colors text-xs font-bold tracking-wide">Cancel</button>' +
                        '<button type="button" id="theme-bg-edit-save" class="px-4 py-2 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 text-xs font-bold tracking-wide transition-colors">Save</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(root);

        var grid = root.querySelector('#theme-bg-default-grid');
        DEFAULT_IMAGES.forEach(function (item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theme-bg-default-card';
            btn.setAttribute('data-theme-bg-default', item.id);
            btn.setAttribute('aria-label', item.name);
            btn.style.cssText = [
                'position:relative',
                'display:block',
                'width:100%',
                'aspect-ratio:16/9',
                'overflow:hidden',
                'padding:0',
                'margin:0',
                'border-radius:var(--theme-box-radius, 0.75rem)',
                'border:1px solid rgba(255,255,255,0.12)',
                'background-color:rgba(0,0,0,0.35)',
                'background-image:url("' + item.url + '")',
                'background-size:cover',
                'background-position:center',
                'cursor:pointer',
                'text-align:left',
            ].join(';');
            btn.innerHTML =
                '<img src="' + item.url + '" alt="" decoding="async" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;" />' +
                '<span style="position:absolute;left:0;right:0;bottom:0;padding:0.4rem 0.55rem;font-size:0.65rem;font-weight:700;letter-spacing:0.04em;color:#fff;background:linear-gradient(to top,rgba(0,0,0,0.75),transparent);">' +
                item.name +
                '</span>';
            btn.addEventListener('click', function () {
                openEditorFromSource({ id: 'default:' + item.id, url: item.url });
            });
            grid.appendChild(btn);
        });

        els = {
            modal: root.querySelector('#theme-bg-modal'),
            box: root.querySelector('#theme-bg-box'),
            closeBtn: root.querySelector('#theme-bg-close'),
            menuView: root.querySelector('#theme-bg-menu-view'),
            pickerView: root.querySelector('#theme-bg-picker-view'),
            changeBtn: root.querySelector('#theme-bg-opt-change'),
            editBtn: root.querySelector('#theme-bg-opt-edit'),
            removeBtn: root.querySelector('#theme-bg-opt-remove'),
            importBtn: root.querySelector('#theme-bg-import'),
            fileInput: root.querySelector('#theme-bg-file-input'),
            editLayer: root.querySelector('#theme-bg-edit-layer'),
            stage: root.querySelector('#theme-bg-edit-stage'),
            imgEl: root.querySelector('#theme-bg-edit-img'),
            controls: root.querySelector('#theme-bg-edit-controls'),
            opacity: root.querySelector('#theme-bg-opacity'),
            opacityVal: root.querySelector('#theme-bg-opacity-val'),
            zoom: root.querySelector('#theme-bg-zoom'),
            zoomVal: root.querySelector('#theme-bg-zoom-val'),
            cancelBtn: root.querySelector('#theme-bg-edit-cancel'),
            saveBtn: root.querySelector('#theme-bg-edit-save'),
        };

        els.closeBtn.addEventListener('click', closeModal);
        els.modal.addEventListener('click', function (e) {
            if (e.target === els.modal) closeModal();
        });
        els.changeBtn.addEventListener('click', function () {
            showPicker();
        });
        els.editBtn.addEventListener('click', function () {
            var bg = currentBgImage();
            if (!bg) {
                toast('No background image to edit.', 'error');
                return;
            }
            openEditorFromSource(bg, { restore: true });
        });
        els.removeBtn.addEventListener('click', onRemove);
        els.importBtn.addEventListener('click', function () {
            els.fileInput.value = '';
            els.fileInput.click();
        });
        els.fileInput.addEventListener('change', onFilePicked);
        els.cancelBtn.addEventListener('click', cancelEdit);
        els.saveBtn.addEventListener('click', onSave);
        els.opacity.addEventListener('input', function () {
            opacity = Math.max(0.05, Math.min(1, Number(els.opacity.value) / 100));
            els.opacityVal.textContent = Math.round(opacity * 100) + '%';
            layoutEditImage();
        });
        els.zoom.addEventListener('input', function () {
            scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(els.zoom.value) / 100));
            els.zoomVal.textContent = Math.round(scale * 100) + '%';
            clampOffset();
            layoutEditImage();
        });

        els.stage.addEventListener('pointerdown', function (e) {
            if (!img || mode !== 'edit') return;
            dragging = true;
            els.stage.setPointerCapture(e.pointerId);
            els.stage.classList.add('cursor-grabbing');
            els.stage.classList.remove('cursor-grab');
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            originX = offsetX;
            originY = offsetY;
        });
        els.stage.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            offsetX = originX + (e.clientX - dragStartX);
            offsetY = originY + (e.clientY - dragStartY);
            clampOffset();
            layoutEditImage();
        });
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            try { els.stage.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            els.stage.classList.remove('cursor-grabbing');
            els.stage.classList.add('cursor-grab');
        }
        els.stage.addEventListener('pointerup', endDrag);
        els.stage.addEventListener('pointercancel', endDrag);
        els.stage.addEventListener('wheel', function (e) {
            if (!img || mode !== 'edit') return;
            e.preventDefault();
            scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale + (e.deltaY < 0 ? 0.08 : -0.08)));
            els.zoom.value = String(Math.round(scale * 100));
            els.zoomVal.textContent = Math.round(scale * 100) + '%';
            clampOffset();
            layoutEditImage();
        }, { passive: false });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (mode === 'edit') cancelEdit();
            else if (mode === 'menu' || mode === 'picker') closeModal();
        });

        window.addEventListener('resize', function () {
            if (mode === 'edit') {
                clampOffset();
                layoutEditImage();
            }
        });

        return els;
    }

    function setModalOpen(isOpen) {
        ensureDom();
        if (isOpen) {
            els.modal.classList.remove('pointer-events-none', 'opacity-0');
            els.modal.classList.add('pointer-events-auto', 'opacity-100');
            els.box.classList.remove('scale-95', 'opacity-0');
            els.box.classList.add('scale-100', 'opacity-100');
            els.modal.setAttribute('aria-hidden', 'false');
        } else {
            els.modal.classList.add('pointer-events-none', 'opacity-0');
            els.modal.classList.remove('pointer-events-auto', 'opacity-100');
            els.box.classList.add('scale-95', 'opacity-0');
            els.box.classList.remove('scale-100', 'opacity-100');
            els.modal.setAttribute('aria-hidden', 'true');
        }
    }

    function closeModal() {
        if (mode === 'edit') return;
        mode = 'closed';
        setModalOpen(false);
    }

    function showMenu() {
        ensureDom();
        mode = 'menu';
        els.menuView.classList.remove('hidden');
        els.pickerView.classList.add('hidden');
        setModalOpen(true);
    }

    function showPicker() {
        ensureDom();
        mode = 'picker';
        els.menuView.classList.add('hidden');
        els.pickerView.classList.remove('hidden');
        setModalOpen(true);
    }

    function clearObjectUrl() {
        if (objectUrl) {
            try { URL.revokeObjectURL(objectUrl); } catch (_) { /* ignore */ }
            objectUrl = null;
        }
    }

    function getBgColor() {
        var settings = loadSettings();
        var hex = settings && settings.lookFeel && settings.lookFeel.customTheme
            && settings.lookFeel.customTheme.bgColor;
        return hex || getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim() || '#000000';
    }

    function setEditingChrome(on) {
        document.body.classList.toggle('theme-bg-editing', !!on);
        var content = document.getElementById('spa-content');
        var footer = document.getElementById('spa-shell-footer');
        var boot = document.getElementById('spa-boot-overlay');
        [content, footer, boot].forEach(function (el) {
            if (!el) return;
            if (on) {
                // Idempotent: only stash previous styles once so a second call
                // cannot lock pointer-events permanently to "none".
                if (el.dataset.themeBgEditing !== '1') {
                    el.dataset.themeBgEditing = '1';
                    el.dataset.themeBgPrevOpacity = el.style.opacity || '';
                    el.dataset.themeBgPrevPe = el.style.pointerEvents || '';
                }
                el.style.transition = 'opacity 0.3s ease';
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
            } else {
                el.style.transition = 'opacity 0.3s ease';
                if (el.dataset.themeBgEditing === '1') {
                    el.style.opacity = el.dataset.themeBgPrevOpacity || '';
                    el.style.pointerEvents = el.dataset.themeBgPrevPe || '';
                } else {
                    el.style.opacity = '';
                    el.style.pointerEvents = '';
                }
                delete el.dataset.themeBgPrevOpacity;
                delete el.dataset.themeBgPrevPe;
                delete el.dataset.themeBgEditing;
                window.setTimeout(function () {
                    if (el.dataset.themeBgEditing === '1') return;
                    el.style.transition = '';
                }, 340);
            }
        });
    }

    function delay(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
        });
    }

    function scrollPageToTop() {
        var bodyEl = document.getElementById('app-body');
        try {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (_) {
            window.scrollTo(0, 0);
        }
        if (bodyEl) {
            try {
                bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (_) {
                bodyEl.scrollTop = 0;
            }
        }
        try { document.documentElement.scrollTop = 0; } catch (_) { /* ignore */ }
    }

    function waitForScrollTop(maxMs) {
        var limit = Math.max(120, Number(maxMs) || 450);
        return new Promise(function (resolve) {
            var started = Date.now();
            var bodyEl = document.getElementById('app-body');
            var tick = function () {
                var y = Math.max(
                    window.scrollY || 0,
                    document.documentElement.scrollTop || 0,
                    bodyEl ? (bodyEl.scrollTop || 0) : 0
                );
                if (y <= 2 || Date.now() - started >= limit) {
                    resolve();
                    return;
                }
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    function scrollToSettingsSearch() {
        var el = document.getElementById('settings-search');
        if (!el) return;
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) {
            try {
                var top = el.getBoundingClientRect().top + (window.scrollY || 0) - 80;
                window.scrollTo(0, Math.max(0, top));
            } catch (err) { /* ignore */ }
        }
    }

    function whenAppBgReady(url, timeoutMs) {
        if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.whenThemeBackgroundReady === 'function') {
            return window.usertypo_settingsApi.whenThemeBackgroundReady(url, timeoutMs);
        }
        return Promise.resolve(false);
    }

    function setControlsVisible(on) {
        if (!els || !els.controls) return;
        if (on) {
            els.controls.classList.remove('opacity-0', 'pointer-events-none');
            els.controls.classList.add('opacity-100', 'pointer-events-auto');
        } else {
            els.controls.classList.add('opacity-0', 'pointer-events-none');
            els.controls.classList.remove('opacity-100', 'pointer-events-auto');
        }
    }

    function setEditLayerOpen(on, opts) {
        ensureDom();
        var instant = opts && opts.instant;
        if (instant) {
            els.editLayer.style.transition = 'none';
            els.imgEl.style.transition = 'none';
            if (els.controls) els.controls.style.transition = 'none';
        }
        if (on) {
            els.editLayer.classList.remove('pointer-events-none', 'opacity-0', 'invisible');
            els.editLayer.classList.add('pointer-events-auto', 'opacity-100');
            els.editLayer.setAttribute('aria-hidden', 'false');
        } else {
            els.editLayer.classList.add('pointer-events-none', 'opacity-0', 'invisible');
            els.editLayer.classList.remove('pointer-events-auto', 'opacity-100');
            els.editLayer.setAttribute('aria-hidden', 'true');
            setControlsVisible(false);
            if (els.imgEl) {
                els.imgEl.style.opacity = '0';
            }
        }
        if (instant) {
            void els.editLayer.offsetHeight;
            els.editLayer.style.transition = '';
            els.imgEl.style.transition = '';
            if (els.controls) els.controls.style.transition = '';
        }
    }

    function stageSize() {
        return {
            w: els.stage.clientWidth || window.innerWidth,
            h: els.stage.clientHeight || window.innerHeight,
        };
    }

    function clampOffset() {
        if (!img) return;
        var size = stageSize();
        var dw = img.naturalWidth * coverScale * scale;
        var dh = img.naturalHeight * coverScale * scale;
        var maxX = Math.max(0, (dw - size.w) / 2);
        var maxY = Math.max(0, (dh - size.h) / 2);
        offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
        offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    }

    function layoutEditImage() {
        if (!els || !img) return;
        var size = stageSize();
        var dw = img.naturalWidth * coverScale * scale;
        var dh = img.naturalHeight * coverScale * scale;
        var x = (size.w - dw) / 2 + offsetX;
        var y = (size.h - dh) / 2 + offsetY;
        els.stage.style.background = getBgColor();
        els.imgEl.style.width = dw + 'px';
        els.imgEl.style.height = dh + 'px';
        els.imgEl.style.left = x + 'px';
        els.imgEl.style.top = y + 'px';
        // Keep transform opacity on the element via style; visibility fade uses class.
        els.imgEl.style.opacity = String(opacity);
        els.imgEl.src = imgUrl;
    }

    function offsetsToNormalized() {
        if (!img) return { offsetX: 0.5, offsetY: 0.5 };
        var size = stageSize();
        var dw = img.naturalWidth * coverScale * scale;
        var dh = img.naturalHeight * coverScale * scale;
        var maxX = Math.max(0, (dw - size.w) / 2);
        var maxY = Math.max(0, (dh - size.h) / 2);
        return {
            offsetX: maxX <= 0 ? 0.5 : (offsetX + maxX) / (2 * maxX),
            offsetY: maxY <= 0 ? 0.5 : (offsetY + maxY) / (2 * maxY),
        };
    }

    function normalizedToOffsets(nx, ny) {
        if (!img) {
            offsetX = 0;
            offsetY = 0;
            return;
        }
        var size = stageSize();
        var dw = img.naturalWidth * coverScale * scale;
        var dh = img.naturalHeight * coverScale * scale;
        var maxX = Math.max(0, (dw - size.w) / 2);
        var maxY = Math.max(0, (dh - size.h) / 2);
        var x = Number.isFinite(nx) ? nx : 0.5;
        var y = Number.isFinite(ny) ? ny : 0.5;
        offsetX = maxX <= 0 ? 0 : (x * 2 * maxX) - maxX;
        offsetY = maxY <= 0 ? 0 : (y * 2 * maxY) - maxY;
    }

    function resetTransform(restore) {
        if (!img) return;
        var size = stageSize();
        coverScale = Math.max(size.w / img.naturalWidth, size.h / img.naturalHeight);
        if (restore && restore.zoom != null) {
            scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(restore.zoom) || 1));
        } else {
            scale = 1;
        }
        if (restore && restore.opacity != null) {
            opacity = Math.max(0.05, Math.min(1, Number(restore.opacity) || DEFAULT_OPACITY));
        } else {
            opacity = DEFAULT_OPACITY;
        }
        els.zoom.value = String(Math.round(scale * 100));
        els.zoomVal.textContent = Math.round(scale * 100) + '%';
        els.opacity.value = String(Math.round(opacity * 100));
        els.opacityVal.textContent = Math.round(opacity * 100) + '%';
        if (restore && (restore.offsetX != null || restore.offsetY != null)) {
            normalizedToOffsets(restore.offsetX, restore.offsetY);
        } else {
            offsetX = 0;
            offsetY = 0;
        }
        clampOffset();
        layoutEditImage();
    }

    function loadImage(src, isObjectUrl) {
        return new Promise(function (resolve, reject) {
            var next = new Image();
            if (!isObjectUrl && src.indexOf('data:') !== 0) next.crossOrigin = 'anonymous';
            next.onload = function () {
                img = next;
                imgUrl = src;
                resolve();
            };
            next.onerror = function () {
                reject(new Error('image_load_failed'));
            };
            next.src = src;
        });
    }

    async function openEditorFromSource(source, options) {
        ensureDom();
        setModalOpen(false);
        var src = source && source.url;
        if (!src) {
            toast('Could not open that image.', 'error');
            return;
        }
        if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.normalizeDurableUrl === 'function') {
            if (src.indexOf('data:') !== 0 && src.indexOf('blob:') !== 0) {
                src = window.usertypoThemeAssets.normalizeDurableUrl(src);
            }
        }
        imgId = String((source && source.id) || 'custom');

        // 1) Scroll to top
        scrollPageToTop();
        await waitForScrollTop(550);

        // 2) Fade settings content away (header stays)
        mode = 'edit';
        setControlsVisible(false);
        els.imgEl.style.opacity = '0';
        setEditingChrome(true);
        await delay(320);

        // 3) Show edit stage + image
        setEditLayerOpen(true);
        try {
            clearObjectUrl();
            var isBlob = src.indexOf('blob:') === 0 || src.indexOf('data:') === 0;
            await loadImage(src, isBlob);
            resetTransform(options && options.restore ? source : null);
            // Keep image hidden until the next frame, then fade to theme opacity.
            els.imgEl.style.opacity = '0';
            await delay(30);
            els.imgEl.style.transition = 'opacity 0.3s ease';
            els.imgEl.style.opacity = String(opacity);
            await delay(280);

            // 4) Then show opacity/zoom controls
            setControlsVisible(true);
        } catch (err) {
            toast('Could not load this image.', 'error');
            cancelEdit();
        }
    }

    function exitEditLayer(opts) {
        ensureDom();
        setEditLayerOpen(false, opts);
        setEditingChrome(false);
        img = null;
        imgUrl = '';
    }

    function cancelEdit() {
        exitEditLayer();
        mode = 'closed';
        clearObjectUrl();
        setModalOpen(false);
        syncSettingsButton();
    }

    function compressFileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('read_failed')); };
            reader.onload = function () {
                var tmp = new Image();
                tmp.onload = function () {
                    var w = tmp.naturalWidth;
                    var h = tmp.naturalHeight;
                    var scaleDown = Math.min(1, COMPRESS_MAX_EDGE / Math.max(w, h));
                    var cw = Math.max(1, Math.round(w * scaleDown));
                    var ch = Math.max(1, Math.round(h * scaleDown));
                    var canvas = document.createElement('canvas');
                    canvas.width = cw;
                    canvas.height = ch;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(tmp, 0, 0, cw, ch);
                    var dataUrl = canvas.toDataURL('image/jpeg', COMPRESS_QUALITY);
                    if (dataUrl.length > MAX_DATA_URL_CHARS) {
                        dataUrl = canvas.toDataURL('image/jpeg', 0.55);
                    }
                    if (dataUrl.length > MAX_DATA_URL_CHARS) {
                        reject(new Error('image_too_large'));
                        return;
                    }
                    resolve(dataUrl);
                };
                tmp.onerror = function () { reject(new Error('image_decode_failed')); };
                tmp.src = String(reader.result || '');
            };
            reader.readAsDataURL(file);
        });
    }

    async function onFilePicked(e) {
        var file = e.target && e.target.files && e.target.files[0];
        if (!file) return;
        if (!String(file.type || '').startsWith('image/')) {
            toast('Please choose an image file.', 'error');
            return;
        }
        if (file.size > MAX_IMPORT_BYTES) {
            toast('Image must be 8MB or smaller.', 'error');
            return;
        }
        try {
            var dataUrl = await compressFileToDataUrl(file);
            await openEditorFromSource({ id: 'upload:' + Date.now(), url: dataUrl });
        } catch (err) {
            if (err && err.message === 'image_too_large') {
                toast('Image is too large after compression. Try a smaller file.', 'error');
            } else {
                toast('Could not import that image.', 'error');
            }
        }
    }

    function onRemove() {
        var prev = currentBgImage();
        if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.commitCustomTheme === 'function') {
            window.usertypo_settingsApi.commitCustomTheme({ bgImage: null }, { force: true });
        }
        if (prev && window.usertypoThemeAssets && typeof window.usertypoThemeAssets.deleteByUrl === 'function') {
            window.usertypoThemeAssets.deleteByUrl(prev.url).catch(function () { /* ignore */ });
        }
        closeModal();
        syncSettingsButton();
        toast('Background image removed.', 'delete');
    }

    async function onSave() {
        if (!img || !imgUrl) {
            toast('Nothing to save.', 'error');
            return;
        }
        var prev = currentBgImage();
        var norm = offsetsToNormalized();
        var payload = normalizeBgImage({
            id: imgId || 'custom',
            url: imgUrl,
            opacity: opacity,
            zoom: scale,
            offsetX: norm.offsetX,
            offsetY: norm.offsetY,
        });

        els.saveBtn.disabled = true;
        try {
            // Persist while the edit layer still covers the screen (no flash).
            if (window.usertypoThemeAssets && typeof window.usertypoThemeAssets.persistBgImage === 'function') {
                payload = await window.usertypoThemeAssets.persistBgImage(payload, prev);
            }
            payload = normalizeBgImage(payload);

            // Preload durable URL before commit so #app-bg-image never blanks.
            if (payload && payload.url && payload.url !== imgUrl) {
                await new Promise(function (resolve) {
                    var pre = new Image();
                    pre.onload = function () { resolve(); };
                    pre.onerror = function () { resolve(); };
                    pre.src = payload.url;
                });
            }

            if (window.usertypo_settingsApi && typeof window.usertypo_settingsApi.commitCustomTheme === 'function') {
                window.usertypo_settingsApi.commitCustomTheme({ bgImage: payload }, { force: true });
            }

            // Force account sync now that the URL is durable (R2 / default asset).
            try {
                if (window.usertypoLookFeel && typeof window.usertypoLookFeel.pushNow === 'function') {
                    window.usertypoLookFeel.pushNow({ force: true }).catch(function (err) {
                        console.warn('[theme-bg] cloud push failed', err);
                    });
                }
            } catch (_) { /* ignore */ }

            await whenAppBgReady(payload && payload.url, 900);

            // Instant handoff: live bg is already painted; drop the edit overlay without fading.
            exitEditLayer({ instant: true });
            mode = 'closed';
            clearObjectUrl();
            setModalOpen(false);
            syncSettingsButton();
            toast('Background image saved.', 'check');
            try {
                if (window.usertypo_settingsApi && window.usertypo_settingsApi.syncCustomThemeEditor) {
                    window.usertypo_settingsApi.syncCustomThemeEditor(loadSettings());
                }
            } catch (_) { /* ignore */ }

            // Content fades back in, then scroll to the settings search bar.
            await delay(320);
            scrollToSettingsSearch();
        } catch (err) {
            console.warn('[theme-bg] save/upload failed', err);
            toast('Could not upload background. Try again while signed in.', 'error');
        } finally {
            els.saveBtn.disabled = false;
        }
    }

    function syncSettingsButton() {
        var has = hasBgImage();
        document.querySelectorAll('[data-theme-bg-trigger]').forEach(function (btn) {
            var label = btn.querySelector('[data-theme-bg-label]');
            if (label) label.textContent = has ? 'Edit background image' : 'Set background image';
            btn.classList.toggle('has-bg-image', has);
        });
    }

    function open() {
        ensureDom();
        if (hasBgImage()) showMenu();
        else showPicker();
    }

    window.usertypoThemeBgEditor = {
        open: open,
        close: function () {
            if (mode === 'edit') cancelEdit();
            else closeModal();
        },
        syncButton: syncSettingsButton,
        normalizeBgImage: normalizeBgImage,
        DEFAULT_IMAGES: DEFAULT_IMAGES,
        hasBgImage: hasBgImage,
        currentBgImage: currentBgImage,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncSettingsButton);
    } else {
        syncSettingsButton();
    }
})();
