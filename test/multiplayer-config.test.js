'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeConfig, configKey } = require('../multiplayer/config');
const { createPrompt, normalizeLanguageFile } = require('../multiplayer/prompt');
const { randomIdleDelay } = require('../multiplayer/keep-awake');

test('normalizes and bounds multiplayer configuration', () => {
    assert.deepEqual(normalizeConfig({
        mode: 'words',
        amount: 9999,
        lang: '../English!!',
        punct: '1',
        nums: 0,
    }), {
        mode: 'words',
        amount: 500,
        lang: 'english',
        punct: true,
        nums: false,
    });
    assert.equal(configKey(normalizeConfig({ mode: 'time', amount: 30 })), 'time:30:english:0:0');
});

test('creates a server-owned prompt with the configured word count', () => {
    const root = path.resolve(__dirname, '..');
    const config = normalizeConfig({ mode: 'words', amount: 25, lang: 'english' });
    const prompt = createPrompt(root, config);
    assert.equal(prompt.words.length, 25);
    assert.equal(prompt.targetWordCount, 25);
    assert.match(prompt.textHash, /^[a-f0-9]{16}$/);
});

test('maps client language aliases to files and safely falls back', () => {
    assert.equal(normalizeLanguageFile('english_10k'), 'english_10T');
    const root = path.resolve(__dirname, '..');
    const prompt = createPrompt(root, normalizeConfig({
        mode: 'words',
        amount: 10,
        lang: 'does-not-exist',
    }));
    assert.equal(prompt.words.length, 10);
    assert.ok(prompt.words.every((word) => typeof word === 'string' && word.length > 0));
});

test('self-ping delay is always between 10 and 14 minutes', () => {
    for (let i = 0; i < 100; i += 1) {
        const delay = randomIdleDelay();
        assert.ok(delay >= 10 * 60 * 1000);
        assert.ok(delay <= 14 * 60 * 1000);
    }
});
