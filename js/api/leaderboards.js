/**
 * Leaderboard helpers — prefer Upstash Redis via Edge Function, fall back to Postgres RPC.
 * Public API: window.usertypoLeaderboards
 */
(function () {
    var AVATAR_COLOR_CLASSES = [
        'bg-primary/20 text-primary border-primary/30',
        'bg-purple-500/20 text-purple-400 border-purple-500/30',
        'bg-green-500/20 text-green-400 border-green-500/30',
        'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        'bg-slate-500/20 text-slate-400 border-slate-500/30',
        'bg-orange-500/20 text-orange-400 border-orange-500/30',
        'bg-pink-500/20 text-pink-400 border-pink-500/30',
        'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
        'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
        'bg-teal-500/20 text-teal-400 border-teal-500/30',
    ];

    var redisAvailable = null; // null unknown, true/false after first probe

    function normalizeTimeframe(value) {
        var allowed = { alltime: true, weekly: true, daily: true };
        // Legacy "monthly" clients fall back to all-time.
        if (value === 'monthly') return 'alltime';
        return allowed[value] ? value : 'alltime';
    }

    function normalizeMode(value) {
        return value === 'words' ? 'words' : 'time';
    }

    function initialFor(name) {
        var clean = String(name || '?').trim();
        return (clean.charAt(0) || '?').toUpperCase();
    }

    function colorClassForIndex(index) {
        return AVATAR_COLOR_CLASSES[Math.abs(Number(index) || 0) % AVATAR_COLOR_CLASSES.length];
    }

    function formatAccuracy(value) {
        if (value == null || !isFinite(Number(value))) return '—';
        var n = Number(value);
        return (n % 1 === 0 ? String(n) : n.toFixed(1)) + '%';
    }

    function formatConsistency(value) {
        return formatAccuracy(value);
    }

    function formatWpm(value) {
        if (value == null || !isFinite(Number(value))) return '—';
        return String(Math.round(Number(value)));
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

    function formatRank(rank) {
        var n = Number(rank) || 0;
        return n < 10 ? String(n).padStart(2, '0') : String(n);
    }

    function formatGlobalRankLabel(rank) {
        if (rank == null || !isFinite(Number(rank)) || Number(rank) <= 0) {
            return '—';
        }
        return '#' + Number(rank).toLocaleString();
    }

    function formatModeAmountLabel(mode, amount) {
        if (mode === 'words') return amount + ' words';
        return 'timed ' + amount + 's';
    }

    function renderRankStat(displayEl, tooltipEl, result, context) {
        var mode = normalizeMode(context && context.mode);
        var amount = Math.max(1, Math.round(Number(context && context.amount) || 30));
        var timeframe = normalizeTimeframe(context && context.timeframe);
        var modeLabel = formatModeAmountLabel(mode, amount);
        var timeframeLabel = timeframe === 'alltime' ? 'all-time' : timeframe;

        if (displayEl) {
            if (result && result.error === 'guest') {
                displayEl.textContent = '—';
            } else {
                displayEl.textContent = formatGlobalRankLabel(result && result.rank);
            }
        }

        if (!tooltipEl) return;

        if (result && result.error === 'guest') {
            tooltipEl.textContent = 'Sign in to see your global rank';
            return;
        }
        if (result && result.error === 'auth_missing') {
            tooltipEl.textContent = 'Global rank unavailable';
            return;
        }
        if (!result || result.rank == null) {
            tooltipEl.textContent = 'Complete a ranked test to appear on the global leaderboard';
            return;
        }

        var totalPlayers = Number(result.totalPlayers) || 0;
        tooltipEl.textContent =
            'Global rank #' +
            Number(result.rank).toLocaleString() +
            ' of ' +
            totalPlayers.toLocaleString() +
            ' players (' +
            modeLabel +
            ', ' +
            timeframeLabel +
            ')';
    }

    function mapEntry(row) {
        var rawWpm = row.raw_wpm != null ? row.raw_wpm : row.rawWpm;
        var consistency = row.consistency;
        return {
            rank: Number(row.rank) || 0,
            userId: row.user_id,
            username: row.username || 'Player',
            avatarUrl: row.avatar_url || null,
            level: row.level != null ? Math.max(1, Math.floor(Number(row.level) || 1)) : 1,
            percentToNext: row.percent_to_next != null
                ? Number(row.percent_to_next)
                : (row.percentToNext != null ? Number(row.percentToNext) : 0),
            wpm: Number(row.wpm) || 0,
            rawWpm: rawWpm == null || rawWpm === '' ? null : Number(rawWpm),
            accuracy: row.accuracy == null ? null : Number(row.accuracy),
            consistency: consistency == null || consistency === '' || consistency === '--'
                ? null
                : Number(consistency),
            createdAt: row.session_created_at || null,
        };
    }

    async function getClient() {
        if (!window.usertypoDb) {
            throw new Error('usertypoDb is not loaded');
        }
        return window.usertypoDb.getClient();
    }

    function getSupabasePublicConfig() {
        var cfg = (window.USERTYPO_CONFIG && window.USERTYPO_CONFIG.supabase) || {};
        return {
            url: cfg.url || '',
            key: cfg.anonKey || cfg.publishableKey || '',
        };
    }

    async function callLeaderboardFunction(payload, requireAuth) {
        if (redisAvailable === false) {
            return { ok: false, status: 503, data: { error: 'REDIS_NOT_CONFIGURED' } };
        }

        var cfg = getSupabasePublicConfig();
        if (!cfg.url || !cfg.key) {
            return { ok: false, status: 0, data: { error: 'missing_supabase_config' } };
        }

        var headers = {
            'Content-Type': 'application/json',
            apikey: cfg.key,
        };

        if (requireAuth) {
            if (!window.usertypoDb || typeof window.usertypoDb.getClerkToken !== 'function') {
                return { ok: false, status: 401, data: { error: 'missing_auth' } };
            }
            var token = await window.usertypoDb.getClerkToken();
            if (!token) {
                return { ok: false, status: 401, data: { error: 'missing_auth' } };
            }
            headers.Authorization = 'Bearer ' + token;
        } else {
            // Public top-list still needs the anon apikey; attach Clerk token if present.
            headers.Authorization = 'Bearer ' + cfg.key;
            if (window.usertypoDb && typeof window.usertypoDb.getClerkToken === 'function') {
                try {
                    var maybeToken = await window.usertypoDb.getClerkToken();
                    if (maybeToken) headers.Authorization = 'Bearer ' + maybeToken;
                } catch (e) { /* ignore */ }
            }
        }

        var res = await fetch(cfg.url + '/functions/v1/leaderboards', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
        });

        var data = null;
        try {
            data = await res.json();
        } catch (e) {
            data = { error: 'invalid_response' };
        }

        if (res.status === 503 && data && data.error === 'REDIS_NOT_CONFIGURED') {
            redisAvailable = false;
        } else if (res.ok && data && data.source === 'redis') {
            redisAvailable = true;
        }

        return { ok: res.ok, status: res.status, data: data };
    }

    async function getLeaderboardFromPostgres(options) {
        var client = await getClient();
        var mode = normalizeMode(options && options.mode);
        var amount = Math.max(1, Math.round(Number(options && options.amount) || 30));
        var timeframe = normalizeTimeframe(options && options.timeframe);
        var limit = Math.max(1, Math.min(100, Number(options && options.limit) || 50));

        var result = await client.rpc('get_leaderboard', {
            p_mode: mode,
            p_amount: amount,
            p_timeframe: timeframe,
            p_limit: limit,
        });

        if (result.error) throw result.error;

        var entries = (result.data || []).map(mapEntry);
        if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
            await window.usertypoProgression.attachToList(entries, 'userId');
        }

        return {
            entries: entries,
            mode: mode,
            amount: amount,
            timeframe: timeframe,
            limit: limit,
            source: 'postgres',
        };
    }

    async function getMyRankFromPostgres(options) {
        var client = await getClient();
        var mode = normalizeMode(options && options.mode);
        var amount = Math.max(1, Math.round(Number(options && options.amount) || 30));
        var timeframe = normalizeTimeframe(options && options.timeframe);

        var result = await client.rpc('get_my_leaderboard_rank', {
            p_mode: mode,
            p_amount: amount,
            p_timeframe: timeframe,
        });

        if (result.error) throw result.error;

        var row = (result.data && result.data[0]) || null;
        if (!row) {
            return {
                rank: null,
                wpm: null,
                accuracy: null,
                totalPlayers: 0,
                source: 'postgres',
            };
        }

        return {
            rank: row.rank == null ? null : Number(row.rank),
            wpm: row.wpm == null ? null : Number(row.wpm),
            accuracy: row.accuracy == null ? null : Number(row.accuracy),
            totalPlayers: row.total_players == null ? 0 : Number(row.total_players),
            source: 'postgres',
        };
    }

    async function getLeaderboard(options) {
        var mode = normalizeMode(options && options.mode);
        var amount = Math.max(1, Math.round(Number(options && options.amount) || 30));
        var timeframe = normalizeTimeframe(options && options.timeframe);
        var limit = Math.max(1, Math.min(100, Number(options && options.limit) || 50));

        try {
            var redisResult = await callLeaderboardFunction({
                action: 'top',
                mode: mode,
                amount: amount,
                timeframe: timeframe,
                limit: limit,
            }, false);

            if (redisResult.ok && redisResult.data && Array.isArray(redisResult.data.entries)) {
                var entries = redisResult.data.entries.map(mapEntry);
                if (window.usertypoProgression && typeof window.usertypoProgression.attachToList === 'function') {
                    await window.usertypoProgression.attachToList(entries, 'userId');
                }
                return {
                    entries: entries,
                    mode: mode,
                    amount: amount,
                    timeframe: timeframe,
                    limit: limit,
                    source: 'redis',
                };
            }
        } catch (err) {
            console.warn('[usertypo leaderboards] redis top failed, using postgres', err);
        }

        return getLeaderboardFromPostgres({ mode: mode, amount: amount, timeframe: timeframe, limit: limit });
    }

    async function getMyRank(options) {
        if (!window.usertypoAuth) {
            return { error: 'auth_missing' };
        }

        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            return { error: 'guest' };
        }

        var mode = normalizeMode(options && options.mode);
        var amount = Math.max(1, Math.round(Number(options && options.amount) || 30));
        var timeframe = normalizeTimeframe(options && options.timeframe);

        try {
            var redisResult = await callLeaderboardFunction({
                action: 'rank',
                mode: mode,
                amount: amount,
                timeframe: timeframe,
            }, true);

            if (redisResult.ok && redisResult.data && redisResult.data.source === 'redis') {
                return {
                    rank: redisResult.data.rank == null ? null : Number(redisResult.data.rank),
                    wpm: redisResult.data.wpm == null ? null : Number(redisResult.data.wpm),
                    accuracy: redisResult.data.accuracy == null ? null : Number(redisResult.data.accuracy),
                    totalPlayers: redisResult.data.totalPlayers == null ? 0 : Number(redisResult.data.totalPlayers),
                    source: 'redis',
                };
            }
        } catch (err) {
            console.warn('[usertypo leaderboards] redis rank failed, using postgres', err);
        }

        return getMyRankFromPostgres({ mode: mode, amount: amount, timeframe: timeframe });
    }

    /**
     * Push a qualifying score into Redis (non-blocking helper for sessions.js).
     * Safe no-op when Redis is not configured.
     */
    async function ingestScore(session) {
        if (!session || session.failed) {
            return { skipped: true, reason: 'failed_or_missing' };
        }
        if (!(Number(session.wpm) > 0)) {
            return { skipped: true, reason: 'invalid_wpm' };
        }

        try {
            var result = await callLeaderboardFunction({
                action: 'ingest',
                mode: session.mode,
                amount: session.amount,
                wpm: session.wpm,
                raw_wpm: session.raw_wpm,
                accuracy: session.accuracy,
                consistency: session.consistency,
                created_at: session.created_at,
                failed: !!session.failed,
            }, true);

            if (!result.ok) {
                if (result.data && result.data.error === 'REDIS_NOT_CONFIGURED') {
                    return { skipped: true, reason: 'redis_not_configured' };
                }
                console.warn('[usertypo leaderboards] ingest failed', result.data);
                return { skipped: true, reason: 'ingest_failed', details: result.data };
            }

            return result.data || { skipped: false };
        } catch (err) {
            console.warn('[usertypo leaderboards] ingest error', err);
            return { skipped: true, reason: 'ingest_error' };
        }
    }

    /**
     * After profiles.show_on_leaderboard changes, sync Redis membership.
     * Opt-out removes the user from boards; opt-in reseeds bests from Postgres.
     */
    async function syncVisibility(showOnLeaderboard) {
        try {
            var result = await callLeaderboardFunction({
                action: 'set_visibility',
                show_on_leaderboard: !!showOnLeaderboard,
            }, true);

            if (!result.ok) {
                console.warn('[usertypo leaderboards] visibility sync failed', result.data);
                return { ok: false, details: result.data };
            }
            return { ok: true, data: result.data };
        } catch (err) {
            console.warn('[usertypo leaderboards] visibility sync error', err);
            return { ok: false, error: err };
        }
    }

    window.usertypoLeaderboards = {
        getLeaderboard: getLeaderboard,
        getMyRank: getMyRank,
        ingestScore: ingestScore,
        syncVisibility: syncVisibility,
        initialFor: initialFor,
        colorClassForIndex: colorClassForIndex,
        formatAccuracy: formatAccuracy,
        formatConsistency: formatConsistency,
        formatWpm: formatWpm,
        formatRelativeTime: formatRelativeTime,
        formatRank: formatRank,
        formatGlobalRankLabel: formatGlobalRankLabel,
        renderRankStat: renderRankStat,
    };
})();
