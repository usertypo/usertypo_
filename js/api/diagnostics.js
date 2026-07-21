/**
 * Compact typing diagnostics for Error Diagnostics & Weakness Analysis.
 * Public API: window.usertypoDiagnostics
 *
 * Summary schema (v1):
 * {
 *   v: 1,
 *   t: [mistype, reversal, overshoot, missed, extra],
 *   c: [[char, count], ...],
 *   b: [[bigram, count], ...],
 *   w: [[word, errorCount, durationMsSum, charCountSum], ...],
 *   k: [[expected, typed, count], ...]
 * }
 */
(function () {
    var SCHEMA_VERSION = 1;
    var REAL_ERROR_TYPES = {
        mistype: 0,
        reversal: 1,
        overshoot: 2,
        missed: 3,
        extra: 4,
        'wrong-shift': 0,
    };
    var PER_TEST_CAP = 20;
    var CHAR_CAP = 80;
    var CONFUSION_CAP = 20;
    var HISTORY_LIMIT = 100;

    function isRealError(marker) {
        return marker && marker.type && Object.prototype.hasOwnProperty.call(REAL_ERROR_TYPES, marker.type);
    }

    function normalizeChar(value) {
        if (value == null) return '';
        var text = String(value);
        if (!text) return '';
        if (text === 'Space' || text === ' ') return ' ';
        return text.length === 1 ? text.toLowerCase() : text.toLowerCase();
    }

    function formatCharLabel(value) {
        if (value === ' ' || value === 'Space') return 'Space';
        return String(value == null ? '' : value);
    }

    function bump(map, key, amount) {
        if (!key) return;
        map[key] = (map[key] || 0) + (amount || 1);
    }

    function topEntries(map, limit, pairSplitter) {
        return Object.keys(map)
            .map(function (key) {
                return { key: key, count: map[key] };
            })
            .sort(function (a, b) {
                if (b.count !== a.count) return b.count - a.count;
                return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
            })
            .slice(0, limit)
            .map(function (entry) {
                if (pairSplitter) {
                    var parts = entry.key.split(pairSplitter);
                    return [parts[0], parts[1], entry.count];
                }
                return [entry.key, entry.count];
            });
    }

    /**
     * Build a compact diagnostics summary from Home advanced-graph telemetry.
     */
    function buildSummary(input) {
        var markers = (input && input.errorMarkers) || [];
        var wordTimestamps = (input && input.wordTimestamps) || [];
        var generatedWords = (input && input.generatedWords) || [];

        var types = [0, 0, 0, 0, 0];
        var charErrors = {};
        var bigramErrors = {};
        var confusion = {};
        var wordErrors = {};
        var wordDurations = {};
        var wordChars = {};
        var erroredWordIndexes = {};

        var wordsByIndex = {};
        wordTimestamps.forEach(function (wt) {
            if (!wt || wt.wordIndex == null) return;
            if (wordsByIndex[wt.wordIndex]) return;
            wordsByIndex[wt.wordIndex] = wt;
        });

        markers.forEach(function (marker) {
            if (!isRealError(marker)) return;

            var typeIndex = REAL_ERROR_TYPES[marker.type];
            types[typeIndex] += 1;

            var expected = normalizeChar(marker.expected);
            var typed = normalizeChar(marker.typed);
            var word = String(marker.word || generatedWords[marker.wordIndex] || '').toLowerCase();
            var charIndex = Number(marker.charIndex);

            if (expected) {
                bump(charErrors, expected);
            } else if (typed) {
                // Extras have no expected char — attribute to the key that was pressed.
                bump(charErrors, typed);
            }

            if (expected && typed && expected !== typed) {
                bump(confusion, expected + '\0' + typed);
            }

            if (word && isFinite(charIndex) && charIndex > 0) {
                var prev = normalizeChar(word[charIndex - 1]);
                var curr = expected || normalizeChar(word[charIndex]);
                if (prev && curr) bump(bigramErrors, prev + curr);
            }

            if (word) {
                bump(wordErrors, word);
                if (!Object.prototype.hasOwnProperty.call(wordDurations, word)) {
                    wordDurations[word] = 0;
                    wordChars[word] = 0;
                }
                if (marker.wordIndex != null) {
                    erroredWordIndexes[marker.wordIndex] = word;
                }
            }
        });

        Object.keys(erroredWordIndexes).forEach(function (indexKey) {
            var word = erroredWordIndexes[indexKey];
            var wt = wordsByIndex[indexKey];
            if (!wt || !word) return;
            var duration = Math.max(0, Number(wt.endTime) - Number(wt.startTime));
            if (!isFinite(duration) || duration <= 0) return;
            wordDurations[word] += duration;
            wordChars[word] += Math.max(1, String(wt.word || word).length);
        });

        var words = Object.keys(wordErrors)
            .map(function (word) {
                return [
                    word,
                    wordErrors[word],
                    Math.round(wordDurations[word] || 0),
                    Math.round(wordChars[word] || word.length),
                ];
            })
            .sort(function (a, b) {
                if (b[1] !== a[1]) return b[1] - a[1];
                return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
            })
            .slice(0, PER_TEST_CAP);

        var summary = {
            v: SCHEMA_VERSION,
            t: types,
            c: topEntries(charErrors, CHAR_CAP),
            b: topEntries(bigramErrors, PER_TEST_CAP),
            w: words,
            k: topEntries(confusion, CONFUSION_CAP, '\0'),
        };

        var totalErrors = types.reduce(function (sum, n) { return sum + n; }, 0);
        if (!totalErrors) return null;
        return summary;
    }

    async function requireAuthClient() {
        if (!window.usertypoAuth || !window.usertypoDb) {
            return { error: 'auth_or_db_missing' };
        }
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            return { error: 'guest' };
        }
        var client = await window.usertypoDb.getClient();
        return { client: client, userId: state.user.id };
    }

    async function saveDiagnostics(sessionId, summary, createdAt) {
        if (!sessionId || !summary) {
            return { skipped: true, reason: 'missing_payload' };
        }

        var auth = await requireAuthClient();
        if (auth.error) return { skipped: true, reason: auth.error };

        var result = await auth.client
            .from('typing_session_diagnostics')
            .insert({
                session_id: sessionId,
                user_id: auth.userId,
                created_at: createdAt || new Date().toISOString(),
                summary: summary,
            })
            .select('session_id')
            .single();

        if (result.error) throw result.error;
        return { skipped: false, sessionId: result.data.session_id };
    }

    async function listMyDiagnostics(options) {
        var auth = await requireAuthClient();
        if (auth.error) {
            return { rows: [], error: auth.error };
        }

        var limit = Math.max(1, Math.min(HISTORY_LIMIT, Number(options && options.limit) || HISTORY_LIMIT));
        var result = await auth.client
            .from('typing_session_diagnostics')
            .select('session_id, created_at, summary')
            .eq('user_id', auth.userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (result.error) throw result.error;
        return { rows: result.data || [] };
    }

    function mergeCountMap(target, pairs, valueIndex) {
        (pairs || []).forEach(function (pair) {
            if (!pair || !pair[0]) return;
            var key = pair[0];
            var count = Number(pair[valueIndex == null ? 1 : valueIndex]) || 0;
            target[key] = (target[key] || 0) + count;
        });
    }

    function aggregateDiagnostics(rows) {
        var types = [0, 0, 0, 0, 0];
        var characters = {};
        var bigrams = {};
        var confusions = {};
        var words = {};

        (rows || []).forEach(function (row) {
            var summary = row && row.summary;
            if (!summary) return;

            var t = summary.t || [];
            for (var i = 0; i < 5; i++) {
                types[i] += Number(t[i]) || 0;
            }

            mergeCountMap(characters, summary.c);
            mergeCountMap(bigrams, summary.b);

            (summary.k || []).forEach(function (pair) {
                if (!pair || pair.length < 3) return;
                var key = pair[0] + '\0' + pair[1];
                confusions[key] = (confusions[key] || 0) + (Number(pair[2]) || 0);
            });

            (summary.w || []).forEach(function (entry) {
                if (!entry || !entry[0]) return;
                var word = entry[0];
                if (!words[word]) {
                    words[word] = { errors: 0, durationMs: 0, chars: 0 };
                }
                words[word].errors += Number(entry[1]) || 0;
                words[word].durationMs += Number(entry[2]) || 0;
                words[word].chars += Number(entry[3]) || 0;
            });
        });

        var totalErrors = types.reduce(function (sum, n) { return sum + n; }, 0);
        var typeLabels = ['Mistype', 'Reversal', 'Overshoot', 'Missed', 'Extra'];
        var anatomy = typeLabels.map(function (label, index) {
            var count = types[index];
            return {
                label: label,
                count: count,
                percent: totalErrors ? Math.round((count / totalErrors) * 100) : 0,
            };
        });

        function ranked(map, limit) {
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

        var topCharacters = ranked(characters, 5);
        var topBigrams = ranked(bigrams, 5).map(function (entry) {
            return { bigram: entry.key, count: entry.count };
        });

        var topWords = Object.keys(words)
            .map(function (word) {
                var stats = words[word];
                var minutes = Math.max(stats.durationMs / 60000, 1 / 60000);
                var wpm = (stats.chars / 5) / minutes;
                return {
                    word: word,
                    count: stats.errors,
                    wpm: Math.round(wpm),
                };
            })
            .sort(function (a, b) {
                if (b.count !== a.count) return b.count - a.count;
                return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
            })
            .slice(0, 5);

        var topConfusions = Object.keys(confusions)
            .map(function (key) {
                var parts = key.split('\0');
                return {
                    expected: parts[0],
                    typed: parts[1],
                    count: confusions[key],
                };
            })
            .sort(function (a, b) {
                if (b.count !== a.count) return b.count - a.count;
                return (a.expected + a.typed).localeCompare(b.expected + b.typed);
            })
            .slice(0, 8);

        return {
            testCount: (rows || []).length,
            totalErrors: totalErrors,
            anatomy: anatomy,
            characterCounts: characters,
            topCharacters: topCharacters,
            topBigrams: topBigrams,
            topWords: topWords,
            topConfusions: topConfusions,
        };
    }

    function keyErrorCount(el, counts) {
        if (!el || !counts) return 0;
        var special = el.getAttribute('data-special');
        if (special === 'Space') return Number(counts[' ']) || 0;

        var chars = el.getAttribute('data-chars') || '';
        var seen = {};
        var total = 0;
        for (var i = 0; i < chars.length; i++) {
            var ch = normalizeChar(chars[i]);
            if (!ch || seen[ch]) continue;
            seen[ch] = true;
            total += Number(counts[ch]) || 0;
        }
        return total;
    }

    /**
     * Paint red heat intensities onto a rendered settings-style keymap.
     */
    function applyKeyHeatmap(keymapRoot, counts) {
        if (!keymapRoot) return;
        var keys = keymapRoot.querySelectorAll('.keymap-key');
        var map = counts || {};
        var max = 0;
        Object.keys(map).forEach(function (key) {
            var n = Number(map[key]) || 0;
            if (n > max) max = n;
        });

        keys.forEach(function (el) {
            el.style.backgroundColor = '';
            el.style.borderColor = '';
            el.style.color = '';
            el.style.boxShadow = '';
            el.querySelectorAll('.keymap-main-text, .keymap-shift-text').forEach(function (span) {
                span.style.color = '';
            });

            var count = keyErrorCount(el, map);
            if (!count || !max) return;

            var t = Math.max(0, Math.min(1, count / max));
            var bgAlpha = 0.16 + 0.72 * t;
            var borderAlpha = 0.28 + 0.55 * t;
            el.style.backgroundColor = 'rgba(220, 38, 38, ' + bgAlpha.toFixed(3) + ')';
            el.style.borderColor = 'rgba(248, 113, 113, ' + borderAlpha.toFixed(3) + ')';
            el.style.boxShadow = t > 0.55
                ? '0 0 10px rgba(220, 38, 38, ' + (0.2 + 0.35 * t).toFixed(3) + ')'
                : '';

            var textColor = t > 0.4 ? '#fff7f7' : '#fecaca';
            el.style.color = textColor;
            el.querySelectorAll('.keymap-main-text, .keymap-shift-text').forEach(function (span) {
                span.style.color = textColor;
            });
        });
    }

    window.usertypoDiagnostics = {
        buildSummary: buildSummary,
        saveDiagnostics: saveDiagnostics,
        listMyDiagnostics: listMyDiagnostics,
        aggregateDiagnostics: aggregateDiagnostics,
        applyKeyHeatmap: applyKeyHeatmap,
        formatCharLabel: formatCharLabel,
        HISTORY_LIMIT: HISTORY_LIMIT,
    };
})();
