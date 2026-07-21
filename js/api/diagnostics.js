/**
 * Compact typing diagnostics for Error Diagnostics, Hotspots, and Hand Biometrics.
 * Public API: window.usertypoDiagnostics
 *
 * Summary schema (v1):
 * {
 *   v: 1,
 *   t: [mistype, reversal, overshoot, missed, extra],
 *   c: [[char, count], ...],
 *   b: [[bigram, count], ...],
 *   w: [[word, errorCount, durationMsSum, charCountSum], ...],
 *   k: [[expected, typed, count], ...],
 *   h: [[lChars, lErrors, lMs], [rChars, rErrors, rMs]],
 *   f: [[chars, ms], ...] // 8 fingers: LP LR LM LI RI RM RR RP
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
    var HISTORY_LIMIT = 50;

    // Finger index: 0 LP, 1 LR, 2 LM, 3 LI, 4 RI, 5 RM, 6 RR, 7 RP
    var FINGER_LABELS = [
        'Left Pinky',
        'Left Ring',
        'Left Middle',
        'Left Index',
        'Right Index',
        'Right Middle',
        'Right Ring',
        'Right Pinky',
    ];

    // QWERTY touch-typing map (character → finger index). Space excluded.
    var CHAR_TO_FINGER = {};
    (function buildFingerMap() {
        var groups = [
            '`~1!qaz',
            '2@wsx',
            '3#edc',
            '4$5%rftgvb',
            '6^7&yhnujm',
            '8*ik,<',
            '9(ol.>',
            '0)-_=+[{]}\\;:\'"/?',
        ];
        groups.forEach(function (chars, fingerIndex) {
            for (var i = 0; i < chars.length; i++) {
                CHAR_TO_FINGER[chars[i].toLowerCase()] = fingerIndex;
                CHAR_TO_FINGER[chars[i]] = fingerIndex;
            }
        });
    })();

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

    function fingerForChar(value) {
        var ch = normalizeChar(value);
        if (!ch || ch === ' ') return -1;
        if (Object.prototype.hasOwnProperty.call(CHAR_TO_FINGER, ch)) {
            return CHAR_TO_FINGER[ch];
        }
        if (Object.prototype.hasOwnProperty.call(CHAR_TO_FINGER, value)) {
            return CHAR_TO_FINGER[value];
        }
        return -1;
    }

    function handForFinger(fingerIndex) {
        if (fingerIndex < 0) return -1;
        return fingerIndex <= 3 ? 0 : 1;
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

    function emptyFingerStats() {
        return [
            [0, 0], [0, 0], [0, 0], [0, 0],
            [0, 0], [0, 0], [0, 0], [0, 0],
        ];
    }

    function emptyHandStats() {
        return [
            [0, 0, 0],
            [0, 0, 0],
        ];
    }

    /**
     * Build compact hand/finger timing from word charTimes + error markers.
     */
    function buildHandFingerStats(input) {
        var markers = (input && input.errorMarkers) || [];
        var wordTimestamps = (input && input.wordTimestamps) || [];
        var generatedWords = (input && input.generatedWords) || [];

        var fingers = emptyFingerStats();
        var hands = emptyHandStats();

        markers.forEach(function (marker) {
            if (!isRealError(marker)) return;

            var expected = normalizeChar(marker.expected);
            var typed = normalizeChar(marker.typed);
            var key = expected || typed;
            var finger = fingerForChar(key);
            var hand = handForFinger(finger);
            if (hand >= 0) hands[hand][1] += 1;
        });

        wordTimestamps.forEach(function (wt) {
            if (!wt) return;
            var word = String(wt.word || generatedWords[wt.wordIndex] || '');
            var charTimes = wt.charTimes || [];
            if (!charTimes.length) return;

            var prev = Number(wt.startTime);
            if (!isFinite(prev)) prev = Number(charTimes[0]);

            for (var i = 0; i < charTimes.length; i++) {
                var t = Number(charTimes[i]);
                if (!isFinite(t)) continue;
                var duration = Math.max(0, t - prev);
                prev = t;

                var ch = i < word.length ? word[i] : '';
                var finger = fingerForChar(ch);
                if (finger < 0) continue;

                fingers[finger][0] += 1;
                fingers[finger][1] += duration;

                var hand = handForFinger(finger);
                hands[hand][0] += 1;
                hands[hand][2] += duration;
            }
        });

        return {
            h: [
                [hands[0][0], hands[0][1], Math.round(hands[0][2])],
                [hands[1][0], hands[1][1], Math.round(hands[1][2])],
            ],
            f: fingers.map(function (pair) {
                return [pair[0], Math.round(pair[1])];
            }),
        };
    }

    function hasHandActivity(h) {
        return !!(h && ((h[0] && h[0][0]) || (h[1] && h[1][0])));
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

        var handFinger = buildHandFingerStats(input);

        var summary = {
            v: SCHEMA_VERSION,
            t: types,
            c: topEntries(charErrors, CHAR_CAP),
            b: topEntries(bigramErrors, PER_TEST_CAP),
            w: words,
            k: topEntries(confusion, CONFUSION_CAP, '\0'),
            h: handFinger.h,
            f: handFinger.f,
        };

        var totalErrors = types.reduce(function (sum, n) { return sum + n; }, 0);
        if (!totalErrors && !hasHandActivity(summary.h)) return null;
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
            .slice(0, 6);

        var handTotals = emptyHandStats();
        var fingerTotals = emptyFingerStats();

        (rows || []).forEach(function (row) {
            var summary = row && row.summary;
            if (!summary) return;

            var h = summary.h;
            if (h && h.length >= 2) {
                for (var hi = 0; hi < 2; hi++) {
                    var handRow = h[hi] || [];
                    handTotals[hi][0] += Number(handRow[0]) || 0;
                    handTotals[hi][1] += Number(handRow[1]) || 0;
                    handTotals[hi][2] += Number(handRow[2]) || 0;
                }
            }

            var f = summary.f;
            if (f && f.length) {
                for (var fi = 0; fi < 8; fi++) {
                    var fingerRow = f[fi] || [];
                    fingerTotals[fi][0] += Number(fingerRow[0]) || 0;
                    fingerTotals[fi][1] += Number(fingerRow[1]) || 0;
                }
            }
        });

        function handMetrics(handIndex) {
            var chars = handTotals[handIndex][0];
            var errors = handTotals[handIndex][1];
            var ms = handTotals[handIndex][2];
            var minutes = Math.max(ms / 60000, 1 / 60000);
            var wpm = chars ? Math.round((chars / 5) / minutes) : null;
            var accuracy = (chars + errors) > 0
                ? Math.round((chars / (chars + errors)) * 1000) / 10
                : null;
            return {
                chars: chars,
                errors: errors,
                ms: ms,
                wpm: wpm,
                accuracy: accuracy,
            };
        }

        function slowestFinger(handIndex) {
            var start = handIndex === 0 ? 0 : 4;
            var end = handIndex === 0 ? 4 : 8;
            var slowest = null;
            for (var i = start; i < end; i++) {
                var chars = fingerTotals[i][0];
                var ms = fingerTotals[i][1];
                if (!chars || !ms) continue;
                var minutes = Math.max(ms / 60000, 1 / 60000);
                var wpm = (chars / 5) / minutes;
                if (!slowest || wpm < slowest.wpm) {
                    slowest = { index: i, label: FINGER_LABELS[i], wpm: wpm };
                }
            }
            return slowest ? { label: slowest.label, wpm: Math.round(slowest.wpm) } : null;
        }

        var left = handMetrics(0);
        var right = handMetrics(1);
        var dominance = null;
        if (left.wpm != null && right.wpm != null && (left.wpm + right.wpm) > 0) {
            var avg = (left.wpm + right.wpm) / 2;
            var skew = Math.round(((right.wpm - left.wpm) / avg) * 100);
            if (skew > 0) {
                dominance = { side: 'Right', percent: skew };
            } else if (skew < 0) {
                dominance = { side: 'Left', percent: Math.abs(skew) };
            } else {
                dominance = { side: 'Even', percent: 0 };
            }
        }

        return {
            testCount: (rows || []).length,
            totalErrors: totalErrors,
            anatomy: anatomy,
            characterCounts: characters,
            topCharacters: topCharacters,
            topBigrams: topBigrams,
            topWords: topWords,
            topConfusions: topConfusions,
            hands: {
                left: left,
                right: right,
                leftSlowest: slowestFinger(0),
                rightSlowest: slowestFinger(1),
                dominance: dominance,
            },
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
     * Only the topN hottest physical keys are colored (default 15).
     */
    function applyKeyHeatmap(keymapRoot, counts, options) {
        if (!keymapRoot) return;
        var topN = Math.max(1, Number(options && options.topN) || 15);
        var keys = Array.prototype.slice.call(keymapRoot.querySelectorAll('.keymap-key'));
        var map = counts || {};

        var scored = keys.map(function (el) {
            return { el: el, count: keyErrorCount(el, map) };
        }).filter(function (entry) {
            return entry.count > 0;
        }).sort(function (a, b) {
            if (b.count !== a.count) return b.count - a.count;
            return 0;
        });

        var max = scored.length ? scored[0].count : 0;
        var hotList = scored.slice(0, topN);

        keys.forEach(function (el) {
            el.style.removeProperty('background-color');
            el.style.removeProperty('border-color');
            el.style.removeProperty('color');
            el.style.removeProperty('box-shadow');
            el.removeAttribute('data-hotspot-rank');
            el.removeAttribute('aria-label');
            el.classList.remove('hotspot-key-tip');
            el.querySelectorAll('.keymap-main-text, .keymap-shift-text').forEach(function (span) {
                span.style.removeProperty('color');
            });

            var count = keyErrorCount(el, map);
            if (count > 0) {
                var label = '';
                if (el.getAttribute('data-special') === 'Space') {
                    label = 'Space';
                } else {
                    var raw = (el.getAttribute('data-chars') || '').charAt(0);
                    label = formatCharLabel(raw) || (el.querySelector('.keymap-main-text') || {}).textContent || 'Key';
                }
                el.setAttribute('aria-label', label + ': ' + count + (count === 1 ? ' error' : ' errors'));
                el.classList.add('hotspot-key-tip');
            }

            var isHot = hotList.some(function (entry) { return entry.el === el; });
            if (!isHot || !max) return;

            var t = Math.max(0, Math.min(1, count / max));
            var bgAlpha = 0.35 + 0.55 * t;
            var borderAlpha = 0.55 + 0.4 * t;
            var textColor = t > 0.35 ? '#ffffff' : '#fecaca';

            el.classList.remove(
                'bg-primary/10',
                'border-primary/20',
                'text-primary',
                'text-primary/60'
            );
            el.style.setProperty('background-color', 'rgba(185, 28, 28, ' + bgAlpha.toFixed(3) + ')', 'important');
            el.style.setProperty('border-color', 'rgba(248, 113, 113, ' + borderAlpha.toFixed(3) + ')', 'important');
            el.style.setProperty('color', textColor, 'important');
            el.style.setProperty('box-shadow', 'none', 'important');
            el.querySelectorAll('.keymap-main-text, .keymap-shift-text').forEach(function (span) {
                span.classList.remove('text-primary', 'text-primary/60');
                span.style.setProperty('color', textColor, 'important');
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
        FINGER_LABELS: FINGER_LABELS,
        HISTORY_LIMIT: HISTORY_LIMIT,
    };
})();
