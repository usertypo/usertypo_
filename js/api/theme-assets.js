/**
 * Theme background uploads via Cloudflare R2 worker.
 * Public API: window.usertypoThemeAssets
 */
(function () {
    function workerUrl() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.themeAssets) || {};
        return String(cfg.url || '').replace(/\/+$/, '');
    }

    function isConfigured() {
        return !!workerUrl();
    }

    function isOurAssetUrl(url) {
        var base = workerUrl();
        if (!base || !url) return false;
        return String(url).indexOf(base + '/bg/') === 0;
    }

    function isDefaultAssetUrl(url) {
        return /(?:^|\/)assets\/theme-bgs\//.test(String(url || ''));
    }

    function isEphemeralUrl(url) {
        var u = String(url || '');
        return u.indexOf('data:') === 0 || u.indexOf('blob:') === 0;
    }

    /** Root-relative path for bundled defaults so any device/host can load them. */
    function normalizeDurableUrl(url) {
        var raw = String(url || '');
        if (!raw) return raw;
        if (/^https?:\/\//i.test(raw) || isEphemeralUrl(raw)) return raw;
        var match = raw.match(/(?:^|\/)(assets\/theme-bgs\/[^/?#]+)/i);
        if (match) return '/' + match[1].replace(/^\/+/, '');
        if (raw.charAt(0) === '/') return raw;
        try {
            return new URL(raw, (location && location.origin ? location.origin : '') + '/').href;
        } catch (e) {
            return raw;
        }
    }

    function isDurableUrl(url) {
        var u = String(url || '');
        if (!u || isEphemeralUrl(u)) return false;
        if (isDefaultAssetUrl(u)) return true;
        if (/^https?:\/\//i.test(u)) return true;
        if (u.charAt(0) === '/') return true;
        return false;
    }

    async function getClerkBearer() {
        if (!window.usertypoDb || typeof window.usertypoDb.getClerkToken !== 'function') {
            throw new Error('auth_or_db_missing');
        }
        var token = await window.usertypoDb.getClerkToken();
        if (!token) throw new Error('missing_token');
        return token;
    }

    function isSignedIn() {
        try {
            var state = window.usertypoAuth && window.usertypoAuth.getState && window.usertypoAuth.getState();
            return !!(state && state.isSignedIn && state.user);
        } catch (e) {
            return false;
        }
    }

    /**
     * Upload a Blob/File. Returns { key, url, bytes }.
     */
    async function uploadBlob(blob, contentType) {
        var base = workerUrl();
        if (!base) throw new Error('theme_assets_not_configured');
        if (!isSignedIn()) throw new Error('guest');

        var type = String(contentType || (blob && blob.type) || 'image/jpeg').split(';')[0].trim().toLowerCase();
        if (type === 'image/jpg') type = 'image/jpeg';
        var token = await getClerkBearer();
        var res = await fetch(base + '/upload', {
            method: 'PUT',
            headers: {
                Authorization: 'Bearer ' + token,
                'Content-Type': type,
                Accept: 'application/json',
            },
            body: blob,
        });
        var data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        if (!res.ok) {
            var err = new Error((data && data.error) || ('theme_assets_upload_' + res.status));
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    async function deleteByKey(key) {
        var base = workerUrl();
        if (!base || !key) return { skipped: true };
        if (!isSignedIn()) return { skipped: true, reason: 'guest' };
        var token = await getClerkBearer();
        var path = '/bg/' + String(key).split('/').map(encodeURIComponent).join('/');
        var res = await fetch(base + path, {
            method: 'DELETE',
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json',
            },
        });
        var data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        if (!res.ok && res.status !== 404) {
            var err = new Error((data && data.error) || ('theme_assets_delete_' + res.status));
            err.status = res.status;
            throw err;
        }
        return data || { ok: true };
    }

    /**
     * Presets, the live custom theme, and the site-wide background can share one uploaded object, so an
     * upload must survive until nothing local points at it. Unknown state → in use.
     */
    function isUrlInUse(url, opts) {
        var target = normalizeDurableUrl(url);
        var lf;
        try {
            var api = window.usertypo_settingsApi;
            var settings = api && typeof api.loadSettings === 'function' ? api.loadSettings() : null;
            lf = settings && settings.lookFeel;
        } catch (_) {
            return true;
        }
        if (!lf) return true;
        var refs = [{ bgImage: lf.bgImage }];
        if (!(opts && opts.ignoreLive)) refs.push(lf.customTheme);
        if (Array.isArray(lf.customPresets)) refs = refs.concat(lf.customPresets);
        return refs.some(function (theme) {
            var bg = theme && theme.bgImage;
            return !!(bg && bg.url && normalizeDurableUrl(bg.url) === target);
        });
    }

    async function deleteByUrl(url, opts) {
        var base = workerUrl();
        if (!base || !url || String(url).indexOf(base + '/bg/') !== 0) {
            return { skipped: true };
        }
        if (isUrlInUse(url, opts)) return { skipped: true, reason: 'in_use' };
        var key = String(url).slice((base + '/bg/').length);
        try { key = decodeURIComponent(key); } catch (_) { /* keep */ }
        return deleteByKey(key);
    }

    function dataUrlToBlob(dataUrl) {
        var parts = String(dataUrl || '').split(',');
        if (parts.length < 2) throw new Error('invalid_data_url');
        var meta = parts[0] || '';
        var mimeMatch = meta.match(/data:([^;]+)/);
        var type = (mimeMatch && mimeMatch[1]) || 'image/jpeg';
        var bin = atob(parts[1]);
        var len = bin.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: type });
    }

    /**
     * Ensure bgImage.url is durable (R2 or static default). Uploads data:/blob: when signed in.
     */
    async function persistBgImage(bgImage, previous) {
        if (!bgImage || !bgImage.url) return null;
        var url = String(bgImage.url);
        var next = Object.assign({}, bgImage);

        if (isDefaultAssetUrl(url) || /^https?:\/\//i.test(url) || (url.charAt(0) === '/' && !isEphemeralUrl(url))) {
            next.url = normalizeDurableUrl(url);
            if (previous && previous.url && previous.url !== next.url && isOurAssetUrl(previous.url)) {
                try { await deleteByUrl(previous.url, { ignoreLive: true }); } catch (_) { /* ignore */ }
            }
            return next;
        }

        if (isEphemeralUrl(url)) {
            if (!isConfigured() || !isSignedIn()) {
                // Guest / no worker — keep local data URL (cannot sync cross-device yet)
                return next;
            }
            var blob;
            if (url.indexOf('data:') === 0) {
                blob = dataUrlToBlob(url);
            } else {
                var res = await fetch(url);
                blob = await res.blob();
            }
            var uploaded = await uploadBlob(blob, blob.type || 'image/jpeg');
            next.url = uploaded.url;
            next.key = uploaded.key;
            next.id = 'upload:' + (uploaded.key || Date.now());
            if (previous && previous.url && previous.url !== next.url && isOurAssetUrl(previous.url)) {
                try { await deleteByUrl(previous.url, { ignoreLive: true }); } catch (_) { /* ignore */ }
            }
            return next;
        }

        next.url = normalizeDurableUrl(url);
        return next;
    }

    window.usertypoThemeAssets = {
        isConfigured: isConfigured,
        isOurAssetUrl: isOurAssetUrl,
        isDefaultAssetUrl: isDefaultAssetUrl,
        isEphemeralUrl: isEphemeralUrl,
        isDurableUrl: isDurableUrl,
        normalizeDurableUrl: normalizeDurableUrl,
        uploadBlob: uploadBlob,
        deleteByKey: deleteByKey,
        deleteByUrl: deleteByUrl,
        persistBgImage: persistBgImage,
        dataUrlToBlob: dataUrlToBlob,
    };
})();
