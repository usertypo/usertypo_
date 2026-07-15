const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.map': 'application/json; charset=utf-8',
};

const STATIC_ASSET = /\.(html|css|js|mjs|json|png|jpe?g|gif|svg|webp|woff2?|ico|mp3|wav|map)$/i;

// Client routes that must always get the SPA shell (not a static file).
const SPA_ROUTES = new Set([
    '/',
    '/index.html',
    '/settings',
    '/signin',
    '/sso-callback',
    '/friends',
    '/room',
    '/dual',
    '/leaderboards',
    '/userstats',
]);

function isInsideRoot(filePath) {
    const resolved = path.resolve(filePath);
    const root = ROOT.toLowerCase();
    const file = resolved.toLowerCase();
    return file === root || file.startsWith(root + path.sep);
}

function safePath(urlPath) {
    const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
    let normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
    if (normalized.startsWith(path.sep) || /^[\\/]/.test(normalized)) {
        normalized = normalized.replace(/^[\\/]+/, '');
    }
    // Reject absolute / drive-letter escapes
    if (/^[a-zA-Z]:/.test(normalized)) return null;
    const filePath = path.resolve(ROOT, normalized);
    if (!isInsideRoot(filePath)) return null;
    return filePath;
}

function sendSpaShell(res) {
    const shellPath = path.join(ROOT, 'index.html');
    fs.readFile(shellPath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('SPA shell missing');
            return;
        }
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Disposition': 'inline',
            'Cache-Control': 'no-cache',
            'X-Usertypo-Response': 'spa-shell',
        });
        res.end(data);
    });
}

function sendStaticFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, {
                'Content-Type': 'text/plain; charset=utf-8',
                'X-Usertypo-Response': 'not-found',
            });
            res.end('Not found');
            return;
        }
        const headers = {
            'Content-Type': type,
            'X-Usertypo-Response': 'static',
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
        };
        if (ext === '.html') {
            headers['Content-Disposition'] = 'inline';
            // Mark page fragments so the router can reject accidental shell responses
            if (/[/\\]pages[/\\]/i.test(filePath)) {
                headers['X-Usertypo-Fragment'] = '1';
            }
        }
        res.writeHead(200, headers);
        res.end(data);
    });
}

function sendNotFound(res, message) {
    res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Usertypo-Response': 'not-found',
    });
    res.end(message || 'Not found');
}

const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
    }

    const urlPath = req.url || '/';
    const pathOnly = decodeURIComponent(urlPath.split('?')[0]) || '/';
    const normalizedPath = pathOnly.length > 1 && pathOnly.endsWith('/')
        ? pathOnly.slice(0, -1)
        : pathOnly;

    // Explicit SPA client routes → always the shell
    if (SPA_ROUTES.has(normalizedPath)) {
        if (req.method === 'HEAD') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': 'inline',
                'X-Usertypo-Response': 'spa-shell',
            });
            res.end();
            return;
        }
        return sendSpaShell(res);
    }

    const filePath = safePath(urlPath);
    if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    // Page fragments and static assets must NEVER fall back to the SPA shell.
    // Falling back to index.html here injects a second header/logo into the app
    // (common when OneDrive hasn't hydrated a file yet after reboot).
    const isFragmentOrAsset = STATIC_ASSET.test(normalizedPath)
        || normalizedPath.startsWith('/pages/')
        || normalizedPath.startsWith('/logo-assets/')
        || normalizedPath.startsWith('/sounds/')
        || normalizedPath.startsWith('/css/')
        || normalizedPath.startsWith('/js/');

    fs.stat(filePath, (err, stat) => {
        if (!err && stat.isFile()) {
            if (req.method === 'HEAD') {
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, {
                    'Content-Type': MIME[ext] || 'application/octet-stream',
                    'X-Usertypo-Response': 'static',
                });
                res.end();
                return;
            }
            return sendStaticFile(res, filePath);
        }

        if (isFragmentOrAsset) {
            return sendNotFound(res, 'Asset not found: ' + normalizedPath);
        }

        // Unknown non-asset path → SPA shell (client-side route / refresh support)
        if (req.method === 'HEAD') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': 'inline',
                'X-Usertypo-Response': 'spa-shell',
            });
            res.end();
            return;
        }
        sendSpaShell(res);
    });
});

server.listen(PORT, () => {
    console.log(`usertypo_ SPA dev server: http://localhost:${PORT}`);
    console.log(`Serving from: ${ROOT}`);
});
