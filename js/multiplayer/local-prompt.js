/**
 * Client-side prompt generation for offline bot duals.
 * Mirrors multiplayer/prompt.js without Node dependencies.
 */
(function () {
    'use strict';

    var FALLBACK_WORDS = [
        'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'bright', 'keys', 'while',
        'friends', 'race', 'across', 'every', 'line', 'with', 'steady', 'focus',
        'typing', 'speed', 'accuracy', 'practice', 'makes', 'progress', 'possible',
    ];
    var cache = Object.create(null);

    function randomInt(max) {
        if (max <= 0) return 0;
        var arr = new Uint32Array(1);
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            window.crypto.getRandomValues(arr);
            return arr[0] % max;
        }
        return Math.floor(Math.random() * max);
    }

    function normalizeLanguageFile(language) {
        var safe = String(language || 'english')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '') || 'english';
        return safe.replace(/_(\d+)k$/, '_$1T');
    }

    async function loadWordList(language) {
        var file = normalizeLanguageFile(language);
        if (cache[file]) return cache[file];

        if (typeof loadLanguage === 'function') {
            try {
                var fromHook = await loadLanguage(file);
                if (Array.isArray(fromHook) && fromHook.length >= 10) {
                    cache[file] = fromHook;
                    return fromHook;
                }
            } catch (_) { /* fall through */ }
        }

        var words = FALLBACK_WORDS;
        try {
            var resp = await fetch('lang/' + file + '.json?v=2');
            if (resp.ok) {
                var parsed = await resp.json();
                var list = Array.isArray(parsed) ? parsed : parsed && parsed.words;
                if (Array.isArray(list) && list.length >= 10) {
                    words = list
                        .filter(function (word) {
                            return typeof word === 'string' && word.length > 0 && word.length <= 40;
                        })
                        .slice(0, 100000);
                }
            }
        } catch (_) {
            // Keep fallback list when offline or file missing.
        }

        cache[file] = words;
        return words;
    }

    function decorateWord(word, index, config) {
        var value = String(word);
        if (config.nums && index > 0 && index % 11 === 0) {
            value = String(10 + randomInt(990));
        }
        if (config.punct) {
            if (index % 13 === 0) value = value.charAt(0).toUpperCase() + value.slice(1);
            if (index % 9 === 8) value += ['.', ',', '?', '!'][randomInt(4)];
        }
        return value;
    }

    async function digestText(text) {
        if (window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined') {
            var encoded = new TextEncoder().encode(text);
            var hash = await window.crypto.subtle.digest('SHA-256', encoded);
            return Array.from(new Uint8Array(hash))
                .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
                .join('')
                .slice(0, 16);
        }
        return String(text.length) + ':' + text.slice(0, 8);
    }

    async function createPrompt(config) {
        var source = await loadWordList(config && config.lang);
        var targetWordCount = config.mode === 'words'
            ? config.amount
            : Math.max(120, config.amount * 6);
        var words = [];
        var previous = '';

        for (var i = 0; i < targetWordCount; i += 1) {
            var next = source[randomInt(source.length)] || FALLBACK_WORDS[i % FALLBACK_WORDS.length];
            if (source.length > 1 && next === previous) {
                next = source[(source.indexOf(next) + 1) % source.length];
            }
            words.push(decorateWord(next, i, config));
            previous = next;
        }

        return {
            words: words,
            targetWordCount: targetWordCount,
            textHash: await digestText(words.join(' ')),
        };
    }

    window.usertypoLocalPrompt = {
        createPrompt: createPrompt,
    };
})();
