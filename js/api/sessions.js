/**
 * Typing session helpers — save completed tests to public.typing_sessions
 * Public API: window.usertypoSessions
 */
(function () {
    function round2(n) {
        var x = Number(n);
        if (!isFinite(x)) return 0;
        return Math.round(x * 100) / 100;
    }

    function currentLanguage() {
        try {
            var settings = window.usertypo_settings
                || (typeof loadSettings === 'function' ? loadSettings() : null)
                || {};
            return (settings.languageContent && settings.languageContent.testLanguage) || 'english';
        } catch (e) {
            return 'english';
        }
    }

    async function saveSession(input) {
        if (!window.usertypoAuth || !window.usertypoDb) {
            return { skipped: true, reason: 'auth_or_db_missing' };
        }

        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            return { skipped: true, reason: 'guest' };
        }

        var client = await window.usertypoDb.getClient();
        var userId = state.user.id;

        var payload = {
            user_id: userId,
            mode: input.mode === 'time' ? 'time' : 'words',
            amount: Math.max(1, Math.round(Number(input.amount) || 1)),
            language: String(input.language || currentLanguage()),
            punctuation: !!input.punctuation,
            numbers: !!input.numbers,
            wpm: round2(input.wpm),
            raw_wpm: round2(input.raw_wpm),
            accuracy: round2(input.accuracy),
            consistency: input.consistency == null || input.consistency === '--'
                ? null
                : round2(input.consistency),
            errors: Math.max(0, Math.round(Number(input.errors) || 0)),
            correct_chars: Math.max(0, Math.round(Number(input.correct_chars) || 0)),
            total_chars: Math.max(0, Math.round(Number(input.total_chars) || 0)),
            duration_seconds: Math.max(0, Math.round(Number(input.duration_seconds) || 0)),
            failed: !!input.failed,
            fail_reason: input.fail_reason || null,
        };

        var inserted = await client
            .from('typing_sessions')
            .insert(payload)
            .select('*')
            .single();

        if (inserted.error) throw inserted.error;

        console.info(
            '[usertypo sessions] saved',
            payload.mode + ' ' + payload.amount,
            payload.wpm + ' wpm',
            payload.failed ? '(failed)' : (inserted.data && inserted.data.is_pb ? '(PB)' : '')
        );

        // Keep Postgres as source of truth for history. Redis rankings are updated
        // separately through a secure Edge Function (never from browser Redis keys).
        if (
            !payload.failed &&
            Number(payload.wpm) > 0 &&
            window.usertypoLeaderboards &&
            typeof window.usertypoLeaderboards.ingestScore === 'function'
        ) {
            window.usertypoLeaderboards.ingestScore(inserted.data).then(function (ingest) {
                if (ingest && !ingest.skipped) {
                    console.info(
                        '[usertypo leaderboards] redis ingest',
                        ingest.updated ? 'updated' : 'unchanged',
                        payload.mode + ' ' + payload.amount,
                        payload.wpm + ' wpm'
                    );
                }
            }).catch(function (err) {
                console.warn('[usertypo leaderboards] redis ingest failed', err);
            });
        }

        return { skipped: false, session: inserted.data };
    }

    var TIMED_AMOUNTS = [15, 30, 60, 120];
    var WORD_AMOUNTS = [10, 25, 50, 100];

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

    function bestKey(mode, amount) {
        return mode + ':' + amount;
    }

    function computeBests(sessions) {
        var bests = {};
        var i;
        for (i = 0; i < TIMED_AMOUNTS.length; i++) {
            bests[bestKey('time', TIMED_AMOUNTS[i])] = null;
        }
        for (i = 0; i < WORD_AMOUNTS.length; i++) {
            bests[bestKey('words', WORD_AMOUNTS[i])] = null;
        }

        sessions.forEach(function (session) {
            if (session.failed) return;
            var key = bestKey(session.mode, session.amount);
            if (!Object.prototype.hasOwnProperty.call(bests, key)) return;

            var current = bests[key];
            if (!current || Number(session.wpm) > Number(current.wpm)) {
                bests[key] = {
                    wpm: Number(session.wpm),
                    accuracy: session.accuracy == null ? null : Number(session.accuracy),
                };
            }
        });

        return bests;
    }

    function computeSummary(sessions) {
        var totalSeconds = 0;
        var totalWords = 0;

        sessions.forEach(function (session) {
            totalSeconds += Math.max(0, Number(session.duration_seconds) || 0);
            totalWords += Math.max(0, Math.round((Number(session.correct_chars) || 0) / 5));
        });

        return {
            tests: sessions.length,
            totalSeconds: totalSeconds,
            totalWords: totalWords,
        };
    }

    async function listMySessions(options) {
        var auth = await requireAuthClient();
        if (auth.error) {
            return { sessions: [], total: 0, error: auth.error };
        }

        var limit = Math.max(1, Math.min(50, Number(options && options.limit) || 20));
        var offset = Math.max(0, Number(options && options.offset) || 0);

        var result = await auth.client
            .from('typing_sessions')
            .select('*', { count: 'exact' })
            .eq('user_id', auth.userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (result.error) throw result.error;

        return {
            sessions: result.data || [],
            total: result.count == null ? (result.data || []).length : result.count,
            limit: limit,
            offset: offset,
        };
    }

    async function fetchAllMySessions() {
        var auth = await requireAuthClient();
        if (auth.error) {
            return { sessions: [], error: auth.error };
        }

        var pageSize = 1000;
        var offset = 0;
        var all = [];

        while (true) {
            var result = await auth.client
                .from('typing_sessions')
                .select('mode,amount,wpm,accuracy,raw_wpm,correct_chars,duration_seconds,failed,created_at')
                .eq('user_id', auth.userId)
                .order('created_at', { ascending: false })
                .range(offset, offset + pageSize - 1);

            if (result.error) throw result.error;

            var batch = result.data || [];
            all = all.concat(batch);
            if (batch.length < pageSize) break;
            offset += pageSize;
        }

        return { sessions: all };
    }

    async function getMyStats() {
        var allResult = await fetchAllMySessions();
        if (allResult.error) {
            return { error: allResult.error };
        }

        var sessions = allResult.sessions;
        // We already fetched everything (ordered desc), so we can derive the
        // "recent 20" without an extra network request.
        var recentSessions = sessions.slice(0, 20);

        return {
            summary: computeSummary(sessions),
            bests: computeBests(sessions),
            recentSessions: recentSessions,
            totalSessions: sessions.length,
            hasMore: sessions.length > recentSessions.length,
            allSessions: sessions,
        };
    }

    function formatCompactNumber(value) {
        var n = Number(value) || 0;
        if (n < 1000) return String(n);
        if (n < 1000000) {
            var thousands = n / 1000;
            return (thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10) + 'k';
        }
        var millions = n / 1000000;
        return (millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10) + 'm';
    }

    function formatDurationShort(totalSeconds) {
        var seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
        if (seconds < 60) return seconds + 's';
        if (seconds < 3600) return Math.round(seconds / 60) + 'm';
        var hours = seconds / 3600;
        return (hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10) + 'h';
    }

    function formatAccuracy(value) {
        if (value == null || !isFinite(Number(value))) return '—';
        var n = Number(value);
        return (n % 1 === 0 ? String(n) : n.toFixed(1)) + '%';
    }

    function formatRelativeTime(iso) {
        if (!iso) return '—';
        var then = new Date(iso).getTime();
        if (!isFinite(then)) return '—';

        var diffMs = Date.now() - then;
        var seconds = Math.max(0, Math.floor(diffMs / 1000));
        if (seconds < 60) return seconds <= 1 ? 'just now' : seconds + ' secs ago';
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + (minutes === 1 ? ' min ago' : ' mins ago');
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
        var days = Math.floor(hours / 24);
        if (days === 1) return 'Yesterday';
        if (days < 7) return days + ' days ago';
        return new Date(iso).toLocaleDateString();
    }

    function formatModeLabel(mode, amount) {
        if (mode === 'time') return 'timed ' + amount + 's';
        return 'words ' + amount;
    }

    window.usertypoSessions = {
        saveSession: saveSession,
        currentLanguage: currentLanguage,
        listMySessions: listMySessions,
        getMyStats: getMyStats,
        formatCompactNumber: formatCompactNumber,
        formatDurationShort: formatDurationShort,
        formatAccuracy: formatAccuracy,
        formatRelativeTime: formatRelativeTime,
        formatModeLabel: formatModeLabel,
        TIMED_AMOUNTS: TIMED_AMOUNTS,
        WORD_AMOUNTS: WORD_AMOUNTS,
    };
})();
