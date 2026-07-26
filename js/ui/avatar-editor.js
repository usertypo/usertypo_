/**
 * Profile avatar menu + pan/zoom crop editor (no third-party crop lib).
 * Public API: window.usertypoAvatarEditor
 */
(function () {
    var VIEW = 280;
    var OUT = 512;
    var MIN_ZOOM = 1;
    var MAX_ZOOM = 3;
    var busy = false;

    var els = null;
    var mode = 'menu'; // menu | edit
    var img = null;
    var scale = 1;
    var offsetX = 0;
    var offsetY = 0;
    var coverScale = 1;
    var dragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var originX = 0;
    var originY = 0;
    var objectUrl = null;

    function toast(message, icon) {
        if (window.usertypoNotifications && window.usertypoNotifications.showToast) {
            window.usertypoNotifications.showToast(message, icon || 'photo_camera');
        }
    }

    function defaultAvatar() {
        return (window.usertypoPlayerAvatar && window.usertypoPlayerAvatar.DEFAULT_AVATAR_URL) || '';
    }

    function hasRealPhoto() {
        var profile = window.__USERTYPO_PROFILE__;
        if (profile && profile.avatar_url) return true;
        var state = window.usertypoAuth && window.usertypoAuth.getState && window.usertypoAuth.getState();
        return !!(state && state.user && state.user.hasImage === true && state.user.imageUrl);
    }

    function currentPhotoUrl() {
        var profile = window.__USERTYPO_PROFILE__;
        if (profile && profile.avatar_url) return profile.avatar_url;
        var state = window.usertypoAuth && window.usertypoAuth.getState && window.usertypoAuth.getState();
        if (state && state.user && state.user.hasImage === true && state.user.imageUrl) {
            return state.user.imageUrl;
        }
        var el = document.getElementById('profile-avatar');
        if (el && el.src && el.src.indexOf('data:image/svg+xml') !== 0) return el.src;
        return '';
    }

    function ensureDom() {
        if (els) return els;
        var root = document.createElement('div');
        root.id = 'avatar-editor-root';
        root.innerHTML =
            '<div id="avatar-editor-overlay" class="fixed inset-0 z-[260] flex items-center justify-center pointer-events-none opacity-0 transition-opacity duration-200" aria-hidden="true">' +
                '<div id="avatar-editor-box" class="glass-panel bg-surface/85 !backdrop-blur-sm border border-white/10 rounded-3xl p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] scale-95 opacity-0 transition-all duration-200 w-[min(92vw,24rem)] relative flex flex-col gap-4">' +
                    '<button type="button" id="avatar-editor-close" class="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors" aria-label="Close">' +
                        '<span class="material-symbols-outlined text-[20px]">close</span>' +
                    '</button>' +
                    '<div id="avatar-menu-view" class="flex flex-col gap-3">' +
                        '<div class="text-primary font-bold text-sm flex items-center gap-2 tracking-wide pr-8">' +
                            '<span class="material-symbols-outlined text-[20px]">account_circle</span>' +
                            '<span>Profile photo</span>' +
                        '</div>' +
                        '<p class="text-xs text-slate-400 leading-relaxed">Change, edit, or remove your profile picture.</p>' +
                        '<div class="flex flex-col gap-2 mt-1">' +
                            '<button type="button" id="avatar-opt-change" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 text-sm font-bold transition-colors">' +
                                '<span class="material-symbols-outlined text-[20px]">add_a_photo</span><span>Change photo</span>' +
                            '</button>' +
                            '<button type="button" id="avatar-opt-edit" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface/60 hover:bg-surface text-slate-200 border border-white/10 text-sm font-bold transition-colors">' +
                                '<span class="material-symbols-outlined text-[20px]">crop</span><span>Edit current</span>' +
                            '</button>' +
                            '<button type="button" id="avatar-opt-remove" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-400/20 text-sm font-bold transition-colors">' +
                                '<span class="material-symbols-outlined text-[20px]">delete</span><span>Remove photo</span>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<div id="avatar-edit-view" class="hidden flex flex-col gap-3">' +
                        '<div class="text-primary font-bold text-sm flex items-center gap-2 tracking-wide pr-8">' +
                            '<span class="material-symbols-outlined text-[20px]">crop</span>' +
                            '<span>Edit photo</span>' +
                        '</div>' +
                        '<p class="text-xs text-slate-400">Drag to move · use the slider to zoom</p>' +
                        '<div id="avatar-crop-stage" class="relative mx-auto w-[280px] h-[280px] rounded-full overflow-hidden bg-black/40 border border-white/10 cursor-grab touch-none select-none">' +
                            '<canvas id="avatar-crop-canvas" width="280" height="280" class="block w-full h-full"></canvas>' +
                        '</div>' +
                        '<label class="flex items-center gap-3 text-xs font-bold text-slate-400">' +
                            '<span class="material-symbols-outlined text-[18px]">zoom_in</span>' +
                            '<input id="avatar-zoom" type="range" min="100" max="300" value="100" class="flex-1 accent-[rgb(var(--theme-primary-rgb))]" />' +
                        '</label>' +
                        '<div class="flex justify-end gap-2 mt-1">' +
                            '<button type="button" id="avatar-edit-cancel" class="px-4 py-2 rounded-xl text-slate-400 hover:text-white transition-colors text-xs font-bold tracking-wide">Back</button>' +
                            '<button type="button" id="avatar-edit-save" class="px-4 py-2 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary border border-primary/25 text-xs font-bold tracking-wide transition-colors">Save</button>' +
                        '</div>' +
                    '</div>' +
                    '<input id="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" />' +
                '</div>' +
            '</div>';
        document.body.appendChild(root);

        els = {
            overlay: root.querySelector('#avatar-editor-overlay'),
            box: root.querySelector('#avatar-editor-box'),
            menuView: root.querySelector('#avatar-menu-view'),
            editView: root.querySelector('#avatar-edit-view'),
            closeBtn: root.querySelector('#avatar-editor-close'),
            changeBtn: root.querySelector('#avatar-opt-change'),
            editBtn: root.querySelector('#avatar-opt-edit'),
            removeBtn: root.querySelector('#avatar-opt-remove'),
            cancelBtn: root.querySelector('#avatar-edit-cancel'),
            saveBtn: root.querySelector('#avatar-edit-save'),
            stage: root.querySelector('#avatar-crop-stage'),
            canvas: root.querySelector('#avatar-crop-canvas'),
            zoom: root.querySelector('#avatar-zoom'),
            fileInput: root.querySelector('#avatar-file-input'),
        };

        els.closeBtn.addEventListener('click', close);
        els.overlay.addEventListener('click', function (e) {
            if (e.target === els.overlay) close();
        });
        els.changeBtn.addEventListener('click', function () {
            els.fileInput.value = '';
            els.fileInput.click();
        });
        els.editBtn.addEventListener('click', function () {
            var url = currentPhotoUrl();
            if (!url) {
                toast('No photo to edit.', 'error');
                return;
            }
            openEditorFromUrl(url);
        });
        els.removeBtn.addEventListener('click', onRemove);
        els.cancelBtn.addEventListener('click', function () {
            showMenu();
        });
        els.saveBtn.addEventListener('click', onSave);
        els.fileInput.addEventListener('change', onFilePicked);
        els.zoom.addEventListener('input', function () {
            scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(els.zoom.value) / 100));
            clampOffset();
            draw();
        });

        els.stage.addEventListener('pointerdown', function (e) {
            if (!img) return;
            dragging = true;
            els.stage.setPointerCapture(e.pointerId);
            els.stage.classList.add('cursor-grabbing');
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
            draw();
        });
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            try { els.stage.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            els.stage.classList.remove('cursor-grabbing');
        }
        els.stage.addEventListener('pointerup', endDrag);
        els.stage.addEventListener('pointercancel', endDrag);
        els.stage.addEventListener('wheel', function (e) {
            if (!img) return;
            e.preventDefault();
            var next = scale + (e.deltaY < 0 ? 0.08 : -0.08);
            scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
            els.zoom.value = String(Math.round(scale * 100));
            clampOffset();
            draw();
        }, { passive: false });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && els.overlay && !els.overlay.classList.contains('pointer-events-none')) {
                close();
            }
        });

        return els;
    }

    function setOpen(isOpen) {
        ensureDom();
        if (isOpen) {
            els.overlay.classList.remove('pointer-events-none', 'opacity-0');
            els.overlay.classList.add('pointer-events-auto', 'opacity-100');
            els.box.classList.remove('scale-95', 'opacity-0');
            els.box.classList.add('scale-100', 'opacity-100');
            els.overlay.setAttribute('aria-hidden', 'false');
        } else {
            els.overlay.classList.add('pointer-events-none', 'opacity-0');
            els.overlay.classList.remove('pointer-events-auto', 'opacity-100');
            els.box.classList.add('scale-95', 'opacity-0');
            els.box.classList.remove('scale-100', 'opacity-100');
            els.overlay.setAttribute('aria-hidden', 'true');
        }
    }

    function clearObjectUrl() {
        if (objectUrl) {
            try { URL.revokeObjectURL(objectUrl); } catch (_) { /* ignore */ }
            objectUrl = null;
        }
    }

    function showMenu() {
        mode = 'menu';
        ensureDom();
        els.menuView.classList.remove('hidden');
        els.editView.classList.add('hidden');
        var real = hasRealPhoto();
        els.editBtn.classList.toggle('hidden', !real);
        els.removeBtn.classList.toggle('hidden', !real);
        setOpen(true);
    }

    function showEdit() {
        mode = 'edit';
        els.menuView.classList.add('hidden');
        els.editView.classList.remove('hidden');
        setOpen(true);
    }

    function clampOffset() {
        if (!img) return;
        var dw = img.naturalWidth * coverScale * scale;
        var dh = img.naturalHeight * coverScale * scale;
        var maxX = Math.max(0, (dw - VIEW) / 2);
        var maxY = Math.max(0, (dh - VIEW) / 2);
        offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
        offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    }

    function draw() {
        if (!els || !img) return;
        var ctx = els.canvas.getContext('2d');
        ctx.clearRect(0, 0, VIEW, VIEW);
        var dw = img.naturalWidth * coverScale * scale;
        var dh = img.naturalHeight * coverScale * scale;
        var x = (VIEW - dw) / 2 + offsetX;
        var y = (VIEW - dh) / 2 + offsetY;
        ctx.drawImage(img, x, y, dw, dh);
    }

    function resetTransform() {
        if (!img) return;
        coverScale = Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        els.zoom.value = '100';
        draw();
    }

    function loadImage(src, isObjectUrl) {
        return new Promise(function (resolve, reject) {
            var next = new Image();
            if (!isObjectUrl) next.crossOrigin = 'anonymous';
            next.onload = function () {
                img = next;
                resetTransform();
                resolve();
            };
            next.onerror = function () {
                reject(new Error('image_load_failed'));
            };
            next.src = src;
        });
    }

    async function openEditorFromUrl(url) {
        ensureDom();
        clearObjectUrl();
        showEdit();
        try {
            await loadImage(url, false);
        } catch (err) {
            // CORS fallback: try blob fetch
            try {
                var res = await fetch(url, { mode: 'cors' });
                var blob = await res.blob();
                clearObjectUrl();
                objectUrl = URL.createObjectURL(blob);
                await loadImage(objectUrl, true);
            } catch (e2) {
                toast('Could not load this photo for editing. Try Change photo.', 'error');
                showMenu();
            }
        }
    }

    async function openEditorFromFile(file) {
        ensureDom();
        clearObjectUrl();
        objectUrl = URL.createObjectURL(file);
        showEdit();
        try {
            await loadImage(objectUrl, true);
        } catch (err) {
            toast('Could not open that image.', 'error');
            showMenu();
        }
    }

    function onFilePicked() {
        var file = els.fileInput.files && els.fileInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast('Image must be 5MB or smaller.', 'error');
            return;
        }
        if (file.type && file.type.indexOf('image/') !== 0) {
            toast('Please choose a PNG, JPEG, WebP, or GIF.', 'error');
            return;
        }
        openEditorFromFile(file);
    }

    function exportBlob() {
        return new Promise(function (resolve, reject) {
            if (!img) {
                reject(new Error('no_image'));
                return;
            }
            var canvas = document.createElement('canvas');
            canvas.width = OUT;
            canvas.height = OUT;
            var ctx = canvas.getContext('2d');
            var ratio = OUT / VIEW;
            var dw = img.naturalWidth * coverScale * scale * ratio;
            var dh = img.naturalHeight * coverScale * scale * ratio;
            var x = (OUT - dw) / 2 + offsetX * ratio;
            var y = (OUT - dh) / 2 + offsetY * ratio;
            ctx.fillStyle = '#1a1d23';
            ctx.fillRect(0, 0, OUT, OUT);
            ctx.drawImage(img, x, y, dw, dh);
            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error('export_failed'));
                    return;
                }
                resolve(blob);
            }, 'image/jpeg', 0.92);
        });
    }

    function refreshProfileUi(url) {
        var avatarEl = document.getElementById('profile-avatar');
        var resolved = url || defaultAvatar();
        if (avatarEl && resolved) {
            avatarEl.src = resolved + (resolved.indexOf('data:') === 0 ? '' : ((resolved.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now()));
        }
    }

    async function onSave() {
        if (busy || !img) return;
        if (!window.usertypoProfiles || typeof window.usertypoProfiles.updateMyAvatar !== 'function') {
            toast('Photo upload unavailable.', 'error');
            return;
        }
        busy = true;
        els.saveBtn.disabled = true;
        els.saveBtn.textContent = 'Saving…';
        try {
            var blob = await exportBlob();
            var file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
            var result = await window.usertypoProfiles.updateMyAvatar(file);
            var url = (result && result.profile && result.profile.avatar_url)
                || (result && result.imageUrl)
                || '';
            refreshProfileUi(url);
            toast('Profile photo updated.', 'photo_camera');
            close();
        } catch (err) {
            var code = err && err.message ? String(err.message) : '';
            var msg = 'Could not update photo.';
            if (code === 'file_too_large') msg = 'Image must be 5MB or smaller.';
            toast(msg, 'error');
            console.warn('[usertypo avatar editor] save failed', err);
        } finally {
            busy = false;
            els.saveBtn.disabled = false;
            els.saveBtn.textContent = 'Save';
        }
    }

    async function onRemove() {
        if (busy) return;
        if (!window.usertypoProfiles || typeof window.usertypoProfiles.removeMyAvatar !== 'function') {
            toast('Could not remove photo.', 'error');
            return;
        }
        busy = true;
        els.removeBtn.disabled = true;
        try {
            await window.usertypoProfiles.removeMyAvatar();
            refreshProfileUi('');
            toast('Profile photo removed.', 'delete');
            close();
        } catch (err) {
            toast('Could not remove photo.', 'error');
            console.warn('[usertypo avatar editor] remove failed', err);
        } finally {
            busy = false;
            els.removeBtn.disabled = false;
        }
    }

    function close() {
        setOpen(false);
        mode = 'menu';
        img = null;
        clearObjectUrl();
        busy = false;
    }

    function open() {
        showMenu();
    }

    window.usertypoAvatarEditor = {
        open: open,
        close: close,
    };
})();
