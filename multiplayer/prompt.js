'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FALLBACK_WORDS = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'bright', 'keys', 'while',
    'friends', 'race', 'across', 'every', 'line', 'with', 'steady', 'focus',
    'typing', 'speed', 'accuracy', 'practice', 'makes', 'progress', 'possible',
];
const cache = new Map();

function normalizeLanguageFile(language) {
    const safe = String(language || 'english')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '') || 'english';
    return safe.replace(/_(\d+)k$/, '_$1T');
}

function loadWordList(root, language) {
    const file = normalizeLanguageFile(language);
    if (cache.has(file)) return cache.get(file);

    let words = FALLBACK_WORDS;
    try {
        const candidate = path.join(root, 'lang', file + '.json');
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        const list = Array.isArray(parsed) ? parsed : parsed && parsed.words;
        if (Array.isArray(list) && list.length >= 10) {
            words = list
                .filter((word) => typeof word === 'string' && word.length > 0 && word.length <= 40)
                .slice(0, 100_000);
        }
    } catch {
        // Keep a bounded built-in list if a selected language file is unavailable.
    }

    cache.set(file, words);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return words;
}

function decorateWord(word, index, config) {
    let value = String(word);
    if (config.nums && index > 0 && index % 11 === 0) {
        value = String(10 + crypto.randomInt(990));
    }
    if (config.punct) {
        if (index % 13 === 0) value = value.charAt(0).toUpperCase() + value.slice(1);
        if (index % 9 === 8) value += ['.', ',', '?', '!'][crypto.randomInt(4)];
    }
    return value;
}

function createPrompt(root, config) {
    const source = loadWordList(root, config.lang);
    const targetWordCount = config.mode === 'words'
        ? config.amount
        : Math.max(120, config.amount * 6);
    const words = [];
    let previous = '';

    for (let i = 0; i < targetWordCount; i += 1) {
        let next = source[crypto.randomInt(source.length)] || FALLBACK_WORDS[i % FALLBACK_WORDS.length];
        if (source.length > 1 && next === previous) {
            next = source[(source.indexOf(next) + 1) % source.length];
        }
        words.push(decorateWord(next, i, config));
        previous = next;
    }

    return {
        words,
        targetWordCount,
        textHash: crypto.createHash('sha256').update(words.join(' ')).digest('hex').slice(0, 16),
    };
}

module.exports = {
    createPrompt,
    normalizeLanguageFile,
};
