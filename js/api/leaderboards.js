/**
 * Leaderboard helpers — read public rankings via Supabase RPC.
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

    function normalizeTimeframe(value) {
        var allowed = { alltime: true, monthly: true, weekly: true, daily: true };
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
        return {
            rank: Number(row.rank) || 0,
            userId: row.user_id,
            username: row.username || 'Player',
            avatarUrl: row.avatar_url || null,
            wpm: Number(row.wpm) || 0,
            accuracy: row.accuracy == null ? null : Number(row.accuracy),
            createdAt: row.session_created_at || null,
        };
    }

    async function getClient() {
        if (!window.usertypoDb) {
            throw new Error('usertypoDb is not loaded');
        }
        return window.usertypoDb.getClient();
    }

    async function getLeaderboard(options) {
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
        return {
            entries: entries,
            mode: mode,
            amount: amount,
            timeframe: timeframe,
            limit: limit,
        };
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
            };
        }

        return {
            rank: row.rank == null ? null : Number(row.rank),
            wpm: row.wpm == null ? null : Number(row.wpm),
            accuracy: row.accuracy == null ? null : Number(row.accuracy),
            totalPlayers: row.total_players == null ? 0 : Number(row.total_players),
        };
    }

    window.usertypoLeaderboards = {
        getLeaderboard: getLeaderboard,
        getMyRank: getMyRank,
        initialFor: initialFor,
        colorClassForIndex: colorClassForIndex,
        formatAccuracy: formatAccuracy,
        formatRelativeTime: formatRelativeTime,
        formatRank: formatRank,
        formatGlobalRankLabel: formatGlobalRankLabel,
        renderRankStat: renderRankStat,
    };
})();
