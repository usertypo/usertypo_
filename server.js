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
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || 'https://usertypo.com').replace(/\/+$/, '');
const BACKEND_ONLY = process.env.BACKEND_ONLY === 'true';

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
        PUBLIC_SITE_URL,
        'https://www.usertypo.com',
        'https://usertypo.pages.dev',
        'http://127.0.0.1:3000',
        'http://localhost:3000',
    ].filter(Boolean);
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
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // HSTS only when the request arrived over HTTPS (Render / Cloudflare terminate TLS).
    const proto = String(_req.headers['x-forwarded-proto'] || _req.protocol || '');
    if (proto.split(',')[0].trim() === 'https' || process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

app.get('/health-check', (_req, res) => {
    res.status(200).type('text/plain').send('200 OK');
});

// Approximate country for community stats (Cloudflare cf-ipcountry when present).
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

// Browser calls from usertypo.com → mp.usertypo.com need CORS on HTTP APIs.
app.use('/api', (req, res, next) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    next();
});

const CONTACT_TO = process.env.CONTACT_TO_EMAIL || 'contactus@usertypo.com';
const CONTACT_ALLOWED_PROBLEMS = new Set([
    'Report a User',
    'Report a Bug',
    'Give Feedback',
    'Feature Request',
    'Account Issue',
    'Other',
]);
const contactRateByIp = new Map();

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket.remoteAddress || 'unknown';
}

function allowContactRequest(ip) {
    const now = Date.now();
    const windowMs = 60_000;
    const maxPerWindow = 5;
    let entry = contactRateByIp.get(ip);
    if (!entry || now - entry.windowStart > windowMs) {
        entry = { windowStart: now, count: 0 };
        contactRateByIp.set(ip, entry);
    }
    entry.count += 1;
    if (contactRateByIp.size > 2000) {
        for (const [key, value] of contactRateByIp) {
            if (now - value.windowStart > windowMs) contactRateByIp.delete(key);
        }
    }
    return entry.count <= maxPerWindow;
}

app.options('/api/contact', (req, res) => {
    applyCors(req, res);
    res.end();
});

app.post('/api/contact', express.json({ limit: '32kb' }), async (req, res) => {
    applyCors(req, res);
    try {
        const ip = getClientIp(req);
        if (!allowContactRequest(ip)) {
            res.status(429).json({ error: 'Too many messages. Please wait a minute and try again.' });
            return;
        }

        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const name = String(body.name || '').trim().slice(0, 80);
        const email = String(body.email || '').trim().slice(0, 120);
        const problem = String(body.problem || '').trim().slice(0, 80);
        const description = String(body.description || '').trim().slice(0, 4000);

        if (!name) {
            res.status(400).json({ error: 'Please enter your name.' });
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'Please enter a valid email.' });
            return;
        }
        if (!CONTACT_ALLOWED_PROBLEMS.has(problem)) {
            res.status(400).json({ error: 'Please select a problem type.' });
            return;
        }
        if (!description) {
            res.status(400).json({ error: 'Please add a description.' });
            return;
        }

        const web3Key = String(process.env.WEB3FORMS_ACCESS_KEY || '').trim();
        const resendKey = String(process.env.RESEND_API_KEY || '').trim();

        // Preferred: Web3Forms (simple access key emailed to you).
        if (web3Key) {
            const upstream = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    access_key: web3Key,
                    subject: problem,
                    from_name: 'usertypo_ Contact',
                    name,
                    email,
                    replyto: email,
                    problem,
                    message: description,
                }),
            });
            let upstreamBody = null;
            try { upstreamBody = await upstream.json(); } catch { upstreamBody = null; }
            if (!upstream.ok || !upstreamBody || upstreamBody.success !== true) {
                const message = (upstreamBody && (upstreamBody.message || upstreamBody.error))
                    || 'Could not deliver your message right now.';
                res.status(502).json({ error: String(message) });
                return;
            }
            res.status(200).json({ ok: true });
            return;
        }

        // Optional: Resend API.
        if (resendKey) {
            const from = String(process.env.RESEND_FROM_EMAIL || 'usertypo_ <onboarding@resend.dev>').trim();
            const upstream = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + resendKey,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    from,
                    to: [CONTACT_TO],
                    subject: problem,
                    reply_to: email,
                    text: [
                        'Name: ' + name,
                        'Email: ' + email,
                        'Problem: ' + problem,
                        '',
                        description,
                    ].join('\n'),
                }),
            });
            let upstreamBody = null;
            try { upstreamBody = await upstream.json(); } catch { upstreamBody = null; }
            if (!upstream.ok) {
                const message = (upstreamBody && (upstreamBody.message || upstreamBody.error || upstreamBody.name))
                    || 'Could not deliver your message right now.';
                res.status(502).json({ error: String(message) });
                return;
            }
            res.status(200).json({ ok: true });
            return;
        }

        // Default: FormSubmit.
        // FormSubmit emails show the Origin/Referer URL. Prefer the public site
        // (usertypo.com), not RENDER_EXTERNAL_URL (*.onrender.com).
        // Override with CONTACT_FORMSUBMIT_ORIGIN if needed. First submit from a
        // new origin may require clicking “Activate Form” in the FormSubmit email.
        const formOrigin = String(
            process.env.CONTACT_FORMSUBMIT_ORIGIN
            || PUBLIC_SITE_URL
            || 'https://usertypo.com'
        ).replace(/\/+$/, '');
        const formHeaders = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: formOrigin,
            Referer: formOrigin + '/',
        };

        const payload = {
            name,
            email,
            problem,
            message: description,
            description,
            _replyto: email,
            _subject: problem,
            _template: 'table',
            _captcha: 'false',
        };

        const upstream = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(CONTACT_TO), {
            method: 'POST',
            headers: formHeaders,
            body: JSON.stringify(payload),
        });

        let upstreamBody = null;
        try {
            upstreamBody = await upstream.json();
        } catch {
            upstreamBody = null;
        }

        const upstreamSuccess = upstreamBody
            && (upstreamBody.success === true || upstreamBody.success === 'true');
        const upstreamMessage = String(
            (upstreamBody && (upstreamBody.message || upstreamBody.error)) || ''
        );

        if (!upstream.ok || !upstreamSuccess) {
            const needsActivation = /activat/i.test(upstreamMessage);
            const message = needsActivation
                ? 'Almost ready: check the inbox (and Spam) for '
                    + CONTACT_TO
                    + ', open the FormSubmit email, and click “Activate Form”. Then send again.'
                : (upstreamMessage || 'Could not deliver your message right now.');
            console.warn('[contact] FormSubmit rejected submission', {
                status: upstream.status,
                formOrigin,
                body: upstreamBody,
            });
            res.status(needsActivation ? 409 : 502).json({ error: message, needsActivation: !!needsActivation });
            return;
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('[contact] failed to send message', error);
        res.status(500).json({ error: 'Could not send your message. Please try again.' });
    }
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

// Production on Render: API + Socket.IO only. Website lives on Cloudflare (PUBLIC_SITE_URL).
if (BACKEND_ONLY) {
    app.use((req, res, next) => {
        if (
            req.path === '/health-check'
            || req.path.startsWith('/api/')
            || req.path.startsWith('/socket.io')
        ) {
            next();
            return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
            const joinMatch = /^\/join\/(\d{4})\/?$/.exec(req.path);
            if (joinMatch) {
                res.redirect(302, PUBLIC_SITE_URL + '/room?code=' + encodeURIComponent(joinMatch[1]));
                return;
            }
            const suffix = req.originalUrl && req.originalUrl !== '/' ? req.originalUrl : '';
            res.redirect(302, PUBLIC_SITE_URL + suffix);
            return;
        }
        res.status(404).type('text/plain').send('usertypo_ backend — open ' + PUBLIC_SITE_URL);
    });
} else {
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

    // Invite links: /join/1234 → /room?code=1234 so relative assets resolve from /
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
        '/room', '/dual', '/leaderboards', '/userstats', '/privacy', '/terms', '/about', '/how-it-works', '/security',
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
}

const multiplayer = createMultiplayerServer(server, {
    root: ROOT,
    env: process.env,
    logger: console,
    recordActivity: keepAwake.recordActivity,
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('usertypo_ server: http://localhost:' + PORT);
    if (BACKEND_ONLY) {
        console.log('Mode: backend-only (Socket.IO + /api). Public site: ' + PUBLIC_SITE_URL);
    } else {
        console.log('Serving from: ' + ROOT);
    }
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
