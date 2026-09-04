/**
 * Client-side prompt generation for offline bot duals.
 */
(function () {
    'use strict';

    /** Matches lang/english.json — only used if fetch/loadLanguage fails. */
    var FALLBACK_WORDS = [
        'you', 'the', 'and', 'that', 'what', 'this', 'for', 'have', 'your', 'state',
        'year', 'use', 'may', 'such', 'most', 'also', 'many', 'through', 'own', 'each',
        'seem', 'high', 'world', 'nation', 'hand', 'write', 'become', 'show', 'house', 'both',
        'between', 'develop', 'under', 'move', 'general', 'school', 'same', 'another', 'begin', 'while',
        'number', 'part', 'turn', 'real', 'might', 'point', 'form', 'child', 'few', 'small',
        'since', 'against', 'ask', 'late', 'interest', 'large', 'person', 'end', 'was', 'not',
        'are', 'dont', 'know', 'can', 'with', 'but', 'all', 'just', 'there', 'here',
        'they', 'like', 'get', 'she', 'right', 'out', 'about', 'him', 'now', 'one',
        'come', 'well', 'her', 'how', 'yeah', 'will', 'got', 'want', 'think', 'see',
        'did', 'good', 'who', 'why', 'from', 'let', 'his', 'yes', 'when', 'going',
        'time', 'okay', 'back', 'look', 'would', 'them', 'where', 'were', 'take', 'then',
        'had', 'been', 'our', 'gonna', 'tell', 'really', 'man', 'some', 'say', 'hey',
        'could', 'need', 'something', 'has', 'too', 'more', 'way', 'down', 'make', 'very',
        'never', 'only', 'people', 'over', 'because', 'little', 'please', 'love', 'should', 'mean',
        'said', 'sorry', 'give', 'off', 'thank', 'any', 'two', 'even', 'much', 'doing',
        'sure', 'thing', 'these', 'help', 'first', 'into', 'anything', 'still', 'find', 'life',
        'nothing', 'day', 'god', 'work', 'their', 'again', 'maybe', 'must', 'before', 'other',
        'wait', 'stop', 'call', 'after', 'wont', 'talk', 'away', 'than', 'thought', 'home',
        'night', 'put', 'great', 'those', 'last', 'better', 'everything', 'told', 'new', 'things',
        'always', 'keep', 'long', 'years', 'leave', 'does', 'money', 'around', 'doesnt', 'name',
        'place', 'ever', 'feel', 'guys', 'father', 'guy', 'made', 'old', 'which', 'big',
        'lot', 'done', 'hello', 'nice', 'believe', 'girl', 'someone', 'fine', 'thanks', 'wanted',
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
        // Keep filenames as on disk (english, english_10k, …). Do not rewrite _Nk → _NT.
        return String(language || 'english')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '') || 'english';
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

        var words = null;
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
        } catch (_) { /* try english below */ }

        if ((!words || words.length < 10) && file !== 'english') {
            try {
                var englishResp = await fetch('lang/english.json?v=2');
                if (englishResp.ok) {
                    var englishParsed = await englishResp.json();
                    var englishList = Array.isArray(englishParsed) ? englishParsed : englishParsed && englishParsed.words;
                    if (Array.isArray(englishList) && englishList.length >= 10) {
                        words = englishList
                            .filter(function (word) {
                                return typeof word === 'string' && word.length > 0 && word.length <= 40;
                            })
                            .slice(0, 100000);
                    }
                }
            } catch (_) { /* keep fallback */ }
        }

        if (!words || words.length < 10) words = FALLBACK_WORDS.slice();
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
        // Multiplayer (including local bot duals) always uses English.
        var source = await loadWordList('english');
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
