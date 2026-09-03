'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT = path.resolve(__dirname);

function loadDotEnv() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separator = trimmed.indexOf('=');
        if (separator <= 0) continue;
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
    }
}

loadDotEnv();

const PORT = Number(process.env.PORT) || 3000;

function parseCsvEnv(name) {
    return String(process.env[name] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function allowedBrowserOrigins() {
    const fromEnv = parseCsvEnv('ALLOWED_ORIGINS');
    if (fromEnv.length) return fromEnv;
    return [
        'https://usertypo.com',
        'https://www.usertypo.com',
        'https://usertypo.pages.dev',
        'https://dev.usertypo.com',
        'http://127.0.0.1:3000',
        'http://localhost:3000',
    ];
}

function applyCors(req, res) {
    const origin = String(req.headers.origin || '');
    const allowed = allowedBrowserOrigins();
    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    }
}

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    const proto = String(_req.headers['x-forwarded-proto'] || _req.protocol || '');
    if (proto.split(',')[0].trim() === 'https' || process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

app.get('/health-check', (req, res) => {
    applyCors(req, res);
    res.status(200).type('text/plain').send('200 OK');
});

app.get('/api/geo', (req, res) => {
    applyCors(req, res);
    const raw = String(
        req.headers['cf-ipcountry']
        || req.headers['x-vercel-ip-country']
        || ''
    ).trim().toUpperCase();
    const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1'
        ? raw
        : null;
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).json({ country });
});

app.use('/api', (req, res, next) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    next();
});

function maybeInjectPublicConfig(source) {
    let output = source;
    if (process.env.SUPABASE_PUBLISHABLE_KEY) {
        const escaped = process.env.SUPABASE_PUBLISHABLE_KEY.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        output = output.replace(
            /(supabase:\s*\{[\s\S]*?publishableKey:\s*)'[^']*'/,
            "$1'" + escaped + "'",
        );
    }
    const replacements = [
        ['CLERK_PUBLISHABLE_KEY', /publishableKey:\s*'[^']*'/, 'publishableKey'],
        ['CLERK_FRONTEND_API', /frontendApi:\s*'[^']*'/, 'frontendApi'],
        ['SUPABASE_URL', /url:\s*'[^']*'/, 'url'],
        ['SUPABASE_ANON_KEY', /anonKey:\s*'[^']*'/, 'anonKey'],
        ['MULTIPLAYER_SERVER_URL', /multiplayer:\s*\{[^}]*url:\s*'[^']*'[^}]*\}/s, 'multiplayer'],
        ['LEADERBOARDS_WORKER_URL', /leaderboards:\s*\{[^}]*url:\s*'[^']*'[^}]*\}/s, 'leaderboards'],
    ];
    for (const [envName, pattern, property] of replacements) {
        const value = process.env[envName];
        if (!value) continue;
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        if (property === 'multiplayer') {
            output = output.replace(pattern, "multiplayer: { url: '" + escaped + "', transport: 'cf' }");
        } else if (property === 'leaderboards') {
            output = output.replace(pattern, "leaderboards: { url: '" + escaped + "' }");
        } else {
            output = output.replace(pattern, property + ": '" + escaped + "'");
        }
    }
    return output;
}

app.get('/js/config/public.js', (_req, res) => {
    fs.readFile(path.join(ROOT, 'js', 'config', 'public.js'), 'utf8', (error, source) => {
        if (error) {
            res.status(404).type('text/plain').send('Config not found');
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/javascript').send(maybeInjectPublicConfig(source));
    });
});

app.use((req, res, next) => {
    const blocked = new Set([
        '/server.js', '/package.json', '/package-lock.json',
        '/.env', '/.env.example',
    ]);
    if (
        blocked.has(req.path)
        || req.path.startsWith('/scripts/')
        || req.path.startsWith('/test/')
        || req.path.startsWith('/workers/')
        || req.path.startsWith('/supabase/')
        || req.path.startsWith('/docs/')
    ) {
        res.status(404).type('text/plain').send('Not found');
        return;
    }
    next();
});

app.use(express.static(ROOT, {
    dotfiles: 'deny',
    fallthrough: true,
    index: false,
    redirect: false,
    maxAge: 0,
    setHeaders(res, filePath) {
        const extension = path.extname(filePath).toLowerCase();
        if (['.html', '.js', '.css', '.json'].includes(extension)) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2'].includes(extension)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
        if (extension === '.html' && filePath.includes(path.sep + 'pages' + path.sep)) {
            res.setHeader('X-Usertypo-Fragment', '1');
        }
    },
}));

app.get('/join/:code', (req, res, next) => {
    const code = String(req.params.code || '');
    if (!/^\d{4}$/.test(code)) {
        next();
        return;
    }
    res.redirect(302, '/room?code=' + encodeURIComponent(code));
});

const SPA_ROUTES = new Set([
    '/', '/index.html', '/settings', '/signin', '/sso-callback', '/friends',
    '/multiplayer', '/room', '/dual', '/leaderboards', '/userstats', '/privacy', '/terms', '/about', '/how-it-works', '/security',
]);

app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).type('text/plain').send('Method not allowed');
        return;
    }
    const pathname = (() => {
        try { return new URL(req.originalUrl, 'http://localhost').pathname.replace(/\/+$/, '') || '/'; }
        catch { return '/'; }
    })();
    const looksLikeAsset = path.extname(pathname)
        || pathname.startsWith('/pages/')
        || pathname.startsWith('/lang/')
        || pathname.startsWith('/js/')
        || pathname.startsWith('/css/')
        || pathname.startsWith('/sounds/')
        || pathname.startsWith('/logo-assets/');
    if (looksLikeAsset) {
        res.status(404).type('text/plain').send('Asset not found: ' + pathname);
        return;
    }
    if (SPA_ROUTES.has(pathname) || req.accepts('html')) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Usertypo-Response', 'spa-shell');
        res.sendFile(path.join(ROOT, 'index.html'));
        return;
    }
    next();
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('usertypo_ local server: http://localhost:' + PORT);
    console.log('Serving from: ' + ROOT);
});

function shutdown(signal) {
    console.log('[server] received ' + signal + ', shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server };
