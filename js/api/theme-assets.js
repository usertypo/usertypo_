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
        return /^\/assets\/theme-bgs\//.test(String(url || ''));
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

    async function deleteByUrl(url) {
        var base = workerUrl();
        if (!base || !url || String(url).indexOf(base + '/bg/') !== 0) {
            return { skipped: true };
        }
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

        if (isDefaultAssetUrl(url) || /^https?:\/\//i.test(url)) {
            if (previous && previous.url && previous.url !== url && isOurAssetUrl(previous.url)) {
                try { await deleteByUrl(previous.url); } catch (_) { /* ignore */ }
            }
            return next;
        }

        if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) {
            if (!isConfigured() || !isSignedIn()) {
                // Guest / no worker — keep local data URL
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
                try { await deleteByUrl(previous.url); } catch (_) { /* ignore */ }
            }
            return next;
        }

        return next;
    }

    window.usertypoThemeAssets = {
        isConfigured: isConfigured,
        isOurAssetUrl: isOurAssetUrl,
        isDefaultAssetUrl: isDefaultAssetUrl,
        uploadBlob: uploadBlob,
        deleteByKey: deleteByKey,
        deleteByUrl: deleteByUrl,
        persistBgImage: persistBgImage,
        dataUrlToBlob: dataUrlToBlob,
    };
})();
