'use strict';

/**
 * Build a clean static `dist/` for Cloudflare Pages.
 * Uploading repo root (including node_modules) breaks/stalls Pages deploys.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const SKIP_DIR_NAMES = new Set([
    '.git',
    '.cursor',
    'node_modules',
    'dist',
    'multiplayer',
    'scripts',
    'test',
    'supabase',
    'agent-tools',
    'agent-transcripts',
]);

const SKIP_FILE_NAMES = new Set([
    'server.js',
    'package.json',
    'package-lock.json',
    'render.yaml',
    'wrangler.toml',
    '.env',
    '.env.example',
    '.gitignore',
]);

function shouldSkipDir(name) {
    return SKIP_DIR_NAMES.has(name) || name.startsWith('.');
}

function shouldSkipFile(name) {
    return SKIP_FILE_NAMES.has(name) || name.endsWith('.log');
}

function rimraf(target) {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) continue;
            copyDir(from, to);
            continue;
        }
        if (!entry.isFile()) continue;
        if (shouldSkipFile(entry.name)) continue;
        fs.copyFileSync(from, to);
    }
}

function main() {
    // Ensure CSS + page fragments are fresh before packaging.
    require('child_process').execSync('npm run build:css', {
        cwd: ROOT,
        stdio: 'inherit',
    });
    require('./build-page-fragments.js');

    rimraf(DIST);
    fs.mkdirSync(DIST, { recursive: true });
    copyDir(ROOT, DIST);

    const vendorSrc = path.join(ROOT, 'js', 'vendor', 'socket.io.min.js');
    const socketOut = path.join(DIST, 'js', 'socket.io.min.js');
    if (fs.existsSync(vendorSrc)) {
        fs.mkdirSync(path.dirname(socketOut), { recursive: true });
        fs.copyFileSync(vendorSrc, socketOut);
    }

    const indexHtml = path.join(DIST, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        throw new Error('[build-cloudflare] missing dist/index.html');
    }

    // Cloudflare Pages: a root 404.html disables SPA 200-fallback and returns
    // real HTTP 404 for missing paths (good). But client-routed URLs like
    // /about must ALSO exist as real HTML files, or Google sees 404 and will
    // not index them. Emit a copy of the SPA shell for each app route.
    // https://developers.cloudflare.com/pages/configuration/serving-pages/
    const spaShellRoutes = [
        'about',
        'how-it-works',
        'privacy',
        'terms',
        'security',
        'leaderboards',
        'friends',
        'userstats',
        'settings',
        'signin',
        'sso-callback',
        'room',
        'dual',
    ];
    for (const route of spaShellRoutes) {
        fs.copyFileSync(indexHtml, path.join(DIST, route + '.html'));
    }

    // Unknown paths still get a real 404 status with the SPA shell body
    // (so a mistyped URL can recover client-side if desired).
    fs.copyFileSync(indexHtml, path.join(DIST, '404.html'));

    console.log(
        '[build-cloudflare] wrote static site to ' + DIST
        + ' (' + spaShellRoutes.length + ' SPA shell routes)'
    );
}

main();
