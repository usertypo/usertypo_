/**
 * Adapt & Refine — weakness-targeted word selection from diagnostics.
 * Uses most-errored bigrams + words only. No DB schema changes.
 * Public API: window.usertypoAdaptRefine
 */
(function () {
    'use strict';

    var TARGET_RATIO = 0.8;
    var BIGRAM_LIMIT = 20;
    var WORD_LIMIT = 20;
    var MIN_POOL = 8;

    var profile = {
        bigrams: [],
        words: [],
        ready: false,
        loading: null,
        languageFile: null,
        pool: [],
        poolWeights: [],
    };

    function normalizeToken(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[^a-z0-9_$#]+/gi, '');
    }

    function rankedFromMap(map, limit) {
        return Object.keys(map)
            .map(function (key) {
                return { key: key, count: map[key] };
            })
            .sort(function (a, b) {
                if (b.count !== a.count) return b.count - a.count;
                return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
            })
            .slice(0, limit);
    }

    function buildProfileFromRows(rows) {
        var bigramMap = {};
        var wordMap = {};

        (rows || []).forEach(function (row) {
            var summary = row && row.summary;
            if (!summary) return;

            (summary.b || []).forEach(function (pair) {
                if (!pair || !pair[0]) return;
                var key = String(pair[0]).toLowerCase();
                if (key.length < 2) return;
                bigramMap[key] = (bigramMap[key] || 0) + (Number(pair[1]) || 0);
            });

            (summary.w || []).forEach(function (entry) {
                if (!entry || !entry[0]) return;
                var word = normalizeToken(entry[0]);
                if (!word) return;
                wordMap[word] = (wordMap[word] || 0) + (Number(entry[1]) || 0);
            });
        });

        return {
            bigrams: rankedFromMap(bigramMap, BIGRAM_LIMIT),
            words: rankedFromMap(wordMap, WORD_LIMIT),
        };
    }

    function wordContainsBigram(word, bigram) {
        if (!word || !bigram || bigram.length < 2) return false;
        return word.indexOf(bigram) !== -1;
    }

    function scoreWord(rawWord, bigrams, words) {
        var word = normalizeToken(rawWord);
        if (!word) return 0;

        var score = 0;
        var i;

        for (i = 0; i < words.length; i++) {
            if (words[i].key === word) {
                score += 1000 + (words[i].count || 0) * 40;
                break;
            }
        }

        for (i = 0; i < bigrams.length; i++) {
            if (wordContainsBigram(word, bigrams[i].key)) {
                score += 120 + (bigrams[i].count || 0) * 8;
            }
        }

        return score;
    }

    function rebuildPool(sourceWords) {
        var words = Array.isArray(sourceWords) ? sourceWords : (typeof wordList !== 'undefined' ? wordList : []);
        var scored = [];
        var seen = {};

        words.forEach(function (raw) {
            var base = String(raw || '');
            if (!base) return;
            var key = normalizeToken(base);
            if (!key || seen[key]) return;
            seen[key] = true;

            var score = scoreWord(base, profile.bigrams, profile.words);
            if (score > 0) {
                scored.push({ word: base, score: score });
            }
        });

        scored.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
        });

        profile.pool = scored.map(function (entry) { return entry.word; });
        profile.poolWeights = scored.map(function (entry) { return entry.score; });
        profile.languageFile = (typeof currentLanguageFile !== 'undefined') ? currentLanguageFile : null;
        return profile.pool;
    }

    function pickWeighted(pool, weights) {
        if (!pool.length) return null;
        var total = 0;
        var i;
        for (i = 0; i < weights.length; i++) total += Math.max(1, weights[i] || 1);
        var roll = Math.random() * total;
        var cursor = 0;
        for (i = 0; i < pool.length; i++) {
            cursor += Math.max(1, weights[i] || 1);
            if (roll <= cursor) return pool[i];
        }
        return pool[pool.length - 1];
    }

    function pickFromList(list, avoid) {
        if (!list || !list.length) return null;
        if (list.length === 1) return list[0];
        var attempts = 0;
        var choice = list[Math.floor(Math.random() * list.length)];
        while (choice === avoid && attempts < 8) {
            choice = list[Math.floor(Math.random() * list.length)];
            attempts += 1;
        }
        return choice;
    }

    async function refresh(options) {
        if (profile.loading) return profile.loading;

        profile.loading = (async function () {
            try {
                if (!window.usertypoDiagnostics || typeof window.usertypoDiagnostics.listMyDiagnostics !== 'function') {
                    profile.ready = false;
                    profile.bigrams = [];
                    profile.words = [];
                    rebuildPool(options && options.words);
                    return profile;
                }

                var listed = await window.usertypoDiagnostics.listMyDiagnostics({
                    limit: window.usertypoDiagnostics.HISTORY_LIMIT || 50,
                });

                if (listed.error) {
                    profile.ready = false;
                    profile.bigrams = [];
                    profile.words = [];
                    rebuildPool(options && options.words);
                    return profile;
                }

                var built = buildProfileFromRows(listed.rows || []);
                profile.bigrams = built.bigrams;
                profile.words = built.words;
                profile.ready = profile.bigrams.length > 0 || profile.words.length > 0;
                rebuildPool(options && options.words);
                return profile;
            } finally {
                profile.loading = null;
            }
        })();

        return profile.loading;
    }

    function pickBaseWord(options) {
        var source = (options && options.words) || (typeof wordList !== 'undefined' ? wordList : []);
        var avoid = options && options.avoid;

        if (!profile.pool.length || profile.languageFile !== ((typeof currentLanguageFile !== 'undefined') ? currentLanguageFile : null)) {
            rebuildPool(source);
        }

        var useTarget = profile.pool.length >= Math.min(MIN_POOL, 1) && Math.random() < TARGET_RATIO;
        if (useTarget) {
            var targeted = pickWeighted(profile.pool, profile.poolWeights);
            if (targeted && targeted !== avoid) return targeted;
            if (targeted) return targeted;
        }

        return pickFromList(source, avoid);
    }

    function hasWeaknessData() {
        return !!(profile.ready && (profile.bigrams.length || profile.words.length) && profile.pool.length);
    }

    function getProfile() {
        return {
            ready: profile.ready,
            bigrams: profile.bigrams.slice(),
            words: profile.words.slice(),
            poolSize: profile.pool.length,
            targetRatio: TARGET_RATIO,
        };
    }

    window.usertypoAdaptRefine = {
        TARGET_RATIO: TARGET_RATIO,
        refresh: refresh,
        rebuildPool: rebuildPool,
        pickBaseWord: pickBaseWord,
        hasWeaknessData: hasWeaknessData,
        getProfile: getProfile,
    };
})();
