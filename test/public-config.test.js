'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('public config is Cloudflare-only', () => {
    const src = fs.readFileSync(path.join(root, 'js', 'config', 'public.js'), 'utf8');
    assert.match(src, /transport:\s*'cf'/);
    assert.match(src, /usertypo-mp\.usertypo2026\.workers\.dev/);
    assert.match(src, /usertypo-leaderboards\.usertypo2026\.workers\.dev/);
    assert.doesNotMatch(src, /onrender\.com/);
    assert.doesNotMatch(src, /mp\.usertypo\.com/);
    assert.doesNotMatch(src, /\bbackend:\s*\{/);
});

test('package.json has no Socket.IO or Render keep-awake deps', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    assert.equal(deps['socket.io'], undefined);
    assert.equal(deps['socket.io-client'], undefined);
});
