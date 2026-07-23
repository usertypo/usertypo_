/**
 * Public player profile card — one lean RPC + short cache.
 * Public API: window.usertypoPublicProfile
 */
(function () {
    var CACHE_TTL_MS = 120000;
    var cache = Object.create(null);

    function readCache(userId) {
        var hit = cache[userId];
        if (!hit) return null;
        if ((Date.now() - hit.at) > CACHE_TTL_MS) {
            delete cache[userId];
            return null;
        }
        return hit.data;
    }

    function writeCache(userId, data) {
        if (!userId || !data || data.error) return;
        cache[userId] = { at: Date.now(), data: data };
    }

    function normalizeBests(rows) {
        var bests = {
            'time:15': null, 'time:30': null, 'time:60': null, 'time:120': null,
            'words:10': null, 'words:25': null, 'words:50': null, 'words:100': null,
        };
        (rows || []).forEach(function (row) {
            if (!row || !row.mode || row.amount == null) return;
            var key = row.mode + ':' + row.amount;
            if (!Object.prototype.hasOwnProperty.call(bests, key)) return;
            bests[key] = {
                wpm: Number(row.wpm) || 0,
                accuracy: row.accuracy == null ? null : Number(row.accuracy),
            };
        });
        return bests;
    }

    function normalizeCard(raw) {
        if (!raw || raw.error) return raw;
        var xpInto = Math.max(0, Math.floor(Number(raw.xp_into_level) || 0));
        var xpToNext = Math.max(1, Math.floor(Number(raw.xp_to_next) || 100));
        var level = Math.max(1, Math.floor(Number(raw.level) || 1));
        var summary = raw.summary || {};
        return {
            userId: raw.user_id,
            username: raw.username || raw.display_name || 'Player',
            displayName: raw.display_name || null,
            avatarUrl: raw.avatar_url || '',
            isSelf: !!raw.is_self,
            relationship: raw.relationship || 'none',
            level: level,
            xpIntoLevel: xpInto,
            xpToNext: xpToNext,
            percentToNext: window.usertypoProgression && window.usertypoProgression.percentToNext
                ? window.usertypoProgression.percentToNext(xpInto, xpToNext)
                : Math.round((xpInto / xpToNext) * 1000) / 10,
            currentStreak: Math.max(0, Math.floor(Number(raw.current_streak) || 0)),
            title: raw.title || (window.usertypoProgression && window.usertypoProgression.levelTitle
                ? window.usertypoProgression.levelTitle(level)
                : 'Novice'),
            summary: {
                tests: Math.max(0, Math.floor(Number(summary.tests) || 0)),
                totalSeconds: Math.max(0, Math.floor(Number(summary.total_seconds) || 0)),
                totalWords: Math.max(0, Math.floor(Number(summary.total_words) || 0)),
            },
            bests: normalizeBests(raw.bests),
        };
    }

    async function getCard(userId, options) {
        var id = String(userId || '').trim();
        if (!id || id.indexOf('guest_') === 0) {
            return { error: 'invalid_user' };
        }
        if (!(options && options.force)) {
            var cached = readCache(id);
            if (cached) return cached;
        }
        if (!window.usertypoDb) return { error: 'auth_or_db_missing' };
        if (window.usertypoAuth) await window.usertypoAuth.ready();
        var state = window.usertypoAuth && window.usertypoAuth.getState();
        if (!state || !state.isSignedIn) return { error: 'guest' };

        var client = await window.usertypoDb.getClient();
        var result = await client.rpc('get_public_profile_card', { p_user_id: id });
        if (result.error) throw result.error;
        var card = normalizeCard(result.data || { error: 'user_not_found' });
        writeCache(id, card);
        return card;
    }

    function invalidate(userId) {
        if (userId) delete cache[String(userId)];
    }

    window.usertypoPublicProfile = {
        getCard: getCard,
        invalidate: invalidate,
    };
})();
