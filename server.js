'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createKeepAwake } = require('./multiplayer/keep-awake');
const { createMultiplayerServer } = require('./multiplayer/socket-server');

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
const app = express();
const server = http.createServer(app);
const keepAwake = createKeepAwake({
    enabled: process.env.NODE_ENV === 'production' && process.env.SELF_PING_ENABLED !== 'false',
    baseUrl: process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || '',
    logger: console,
});

app.disable('x-powered-by');
app.use(keepAwake.middleware);
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.get('/health-check', (_req, res) => {
    res.status(200).type('text/plain').send('200 OK');
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
    ];
    for (const [envName, pattern, property] of replacements) {
        const value = process.env[envName];
        if (!value) continue;
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        if (property === 'multiplayer') {
            output = output.replace(pattern, "multiplayer: { url: '" + escaped + "' }");
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
        '/server.js', '/package.json', '/package-lock.json', '/render.yaml',
        '/.env', '/.env.example',
    ]);
    if (
        blocked.has(req.path)
        || req.path.startsWith('/multiplayer/')
        || req.path.startsWith('/scripts/')
        || req.path.startsWith('/test/')
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
    maxAge: '60s',
    setHeaders(res, filePath) {
        if (path.extname(filePath).toLowerCase() === '.html') {
            res.setHeader('Cache-Control', 'no-cache');
            if (filePath.includes(path.sep + 'pages' + path.sep)) {
                res.setHeader('X-Usertypo-Fragment', '1');
            }
        }
    },
}));

const SPA_ROUTES = new Set([
    '/', '/index.html', '/settings', '/signin', '/sso-callback', '/friends',
    '/room', '/dual', '/leaderboards', '/userstats',
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

const multiplayer = createMultiplayerServer(server, {
    root: ROOT,
    env: process.env,
    logger: console,
    recordActivity: keepAwake.recordActivity,
});

server.listen(PORT, () => {
    console.log('usertypo_ server: http://localhost:' + PORT);
    console.log('Serving from: ' + ROOT);
    if (!multiplayer.hasSupabaseServiceRole) {
        console.warn('[multiplayer] SUPABASE_SERVICE_ROLE_KEY is not configured; production friend verification will reject challenges');
    }
    keepAwake.start();
});

function shutdown(signal) {
    console.log('[server] received ' + signal + ', shutting down');
    keepAwake.stop();
    multiplayer.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, multiplayer };
