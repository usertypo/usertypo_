/**
 * Progression helpers — levels, XP, streaks
 * Public API: window.usertypoProgression
 *
 * Server is source of truth (award_session_xp trigger). Client only reads/displays.
 */
(function () {
    var cached = null;

    function xpNeededForLevel(level) {
        var L = Math.max(1, Math.floor(Number(level) || 1));
        return Math.max(1, Math.floor(100 * Math.pow(L, 1.45)));
    }

    function levelTitle(level) {
        var L = Math.max(1, Math.floor(Number(level) || 1));
        if (L >= 100) return 'Legend';
        if (L >= 75) return 'Elite';
        if (L >= 50) return 'Sharp';
        if (L >= 25) return 'Fluent';
        if (L >= 10) return 'Typist';
        return 'Novice';
    }

    function computeLevelFromTotalXp(totalXp) {
        var remaining = Math.max(0, Math.floor(Number(totalXp) || 0));
        var level = 1;
        var need;
        while (level < 10000) {
            need = xpNeededForLevel(level);
            if (remaining < need) break;
            remaining -= need;
            level += 1;
        }
        return {
            level: level,
            xpIntoLevel: remaining,
            xpToNext: xpNeededForLevel(level),
        };
    }

    function percentToNext(xpInto, xpToNext) {
        var into = Math.max(0, Number(xpInto) || 0);
        var need = Math.max(1, Number(xpToNext) || 1);
        return Math.round((into / need) * 1000) / 10;
    }

    function normalizeProgression(row) {
        if (!row || row.skipped) return null;
        var level = Math.max(1, Math.floor(Number(row.level) || 1));
        var xpInto = Math.max(0, Math.floor(Number(row.xp_into_level != null ? row.xp_into_level : row.xpIntoLevel) || 0));
        var xpToNext = row.xp_to_next != null
            ? Math.max(1, Math.floor(Number(row.xp_to_next)))
            : (row.xpToNext != null
                ? Math.max(1, Math.floor(Number(row.xpToNext)))
                : xpNeededForLevel(level));
        var pct = row.percent_to_next != null
            ? Number(row.percent_to_next)
            : (row.percentToNext != null ? Number(row.percentToNext) : percentToNext(xpInto, xpToNext));
        return {
            userId: row.user_id || row.userId || null,
            totalXp: Math.max(0, Math.floor(Number(row.total_xp != null ? row.total_xp : row.totalXp) || 0)),
            level: level,
            xpIntoLevel: xpInto,
            xpToNext: xpToNext,
            percentToNext: pct,
            currentStreak: Math.max(0, Math.floor(Number(row.current_streak != null ? row.current_streak : row.currentStreak) || 0)),
            longestStreak: Math.max(0, Math.floor(Number(row.longest_streak != null ? row.longest_streak : row.longestStreak) || 0)),
            lastPlayDate: row.last_play_date || row.lastPlayDate || null,
            dailyXp: Math.max(0, Math.floor(Number(row.daily_xp != null ? row.daily_xp : row.dailyXp) || 0)),
            dailyXpDate: row.daily_xp_date || row.dailyXpDate || null,
            title: row.title || levelTitle(level),
            updatedAt: row.updated_at || row.updatedAt || null,
        };
    }

    function normalizeAward(payload) {
        if (!payload || typeof payload !== 'object') return null;
        if (payload.skipped) {
            return {
                skipped: true,
                reason: payload.reason || 'skipped',
            };
        }
        var level = Math.max(1, Math.floor(Number(payload.newLevel) || 1));
        var xpInto = Math.max(0, Math.floor(Number(payload.xpIntoLevel) || 0));
        var xpToNext = Math.max(1, Math.floor(Number(payload.xpToNext) || xpNeededForLevel(level)));
        return {
            skipped: false,
            duplicate: !!payload.duplicate,
            xpGained: Math.max(0, Math.floor(Number(payload.xpGained) || 0)),
            leveledUp: !!payload.leveledUp,
            levelBefore: Math.max(1, Math.floor(Number(payload.levelBefore) || 1)),
            newLevel: level,
            totalXp: Math.max(0, Math.floor(Number(payload.totalXp) || 0)),
            xpIntoLevel: xpInto,
            xpToNext: xpToNext,
            percentToNext: payload.percentToNext != null
                ? Number(payload.percentToNext)
                : percentToNext(xpInto, xpToNext),
            streak: Math.max(0, Math.floor(Number(payload.streak) || 0)),
            longestStreak: Math.max(0, Math.floor(Number(payload.longestStreak) || 0)),
            title: payload.title || levelTitle(level),
            reason: payload.reason || null,
        };
    }

    function estimateGuestXp(input) {
        var durationSeconds = Math.max(1, Math.round(Number(input && input.duration_seconds) || 1));
        var accuracy = Number(input && input.accuracy) || 0;
        var wpm = Number(input && input.wpm) || 0;
        // Faster finish → more XP (same formula as server award_session_xp)
        var base = Math.min(80, Math.max(1, Math.floor(1200 / durationSeconds)));
        // Accuracy only cuts below 100%; consistency never affects XP
        var accMult = Math.max(0, Math.min(1, accuracy / 100));
        var wpmMult = 1;
        if (wpm >= 80) wpmMult = 1.25;
        else if (wpm >= 50) wpmMult = 1.1;
        var modMult = (input && (input.punctuation || input.numbers)) ? 1.15 : 1;
        return Math.max(1, Math.floor(base * accMult * wpmMult * modMult));
    }

    function notifyProgression(progression, award) {
        cached = progression || cached;
        window.__USERTYPO_PROGRESSION__ = cached;
        try {
            window.dispatchEvent(new CustomEvent('usertypo:progression-updated', {
                detail: { progression: cached, award: award || null },
            }));
        } catch (e) { /* ignore */ }
    }

    async function requireAuthClient() {
        if (!window.usertypoAuth || !window.usertypoDb) {
            return { skipped: true, reason: 'auth_or_db_missing' };
        }
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn || !state.user) {
            return { skipped: true, reason: 'guest' };
        }
        var client = await window.usertypoDb.getClient();
        return { skipped: false, client: client, userId: state.user.id };
    }

    async function getMine(options) {
        var force = !!(options && options.force);
        if (!force && cached) return cached;

        var auth = await requireAuthClient();
        if (auth.skipped) return null;

        var rpc = await auth.client.rpc('get_my_progression');
        if (rpc.error) {
            // Fallback: direct table read (older deploys / local)
            console.warn('[usertypo progression] get_my_progression RPC failed, falling back', rpc.error);
            try {
                await auth.client.rpc('ensure_user_progression', { p_user_id: auth.userId });
            } catch (e) { /* ignore */ }
            var result = await auth.client
                .from('user_progression')
                .select('*')
                .eq('user_id', auth.userId)
                .maybeSingle();
            if (result.error) throw result.error;
            var fallback = normalizeProgression(result.data);
            if (!fallback) {
                fallback = {
                    userId: auth.userId,
                    totalXp: 0,
                    level: 1,
                    xpIntoLevel: 0,
                    xpToNext: xpNeededForLevel(1),
                    percentToNext: 0,
                    currentStreak: 0,
                    longestStreak: 0,
                    lastPlayDate: null,
                    dailyXp: 0,
                    dailyXpDate: null,
                    title: levelTitle(1),
                    updatedAt: null,
                };
            }
            notifyProgression(fallback, null);
            return fallback;
        }

        var progression = normalizeProgression(rpc.data);
        if (!progression) {
            progression = {
                userId: auth.userId,
                totalXp: 0,
                level: 1,
                xpIntoLevel: 0,
                xpToNext: xpNeededForLevel(1),
                percentToNext: 0,
                currentStreak: 0,
                longestStreak: 0,
                lastPlayDate: null,
                dailyXp: 0,
                dailyXpDate: null,
                title: levelTitle(1),
                updatedAt: null,
            };
        }

        notifyProgression(progression, null);
        return progression;
    }

    async function getAwardForSession(sessionId) {
        if (!sessionId) return { skipped: true, reason: 'missing_session' };
        var auth = await requireAuthClient();
        if (auth.skipped) return auth;

        var rpc = await auth.client.rpc('get_session_xp_award', {
            p_session_id: sessionId,
        });

        if (rpc.error) throw rpc.error;

        var award = normalizeAward(rpc.data);
        if (award && !award.skipped) {
            var progression = {
                userId: auth.userId,
                totalXp: award.totalXp,
                level: award.newLevel,
                xpIntoLevel: award.xpIntoLevel,
                xpToNext: award.xpToNext,
                percentToNext: award.percentToNext,
                currentStreak: award.streak,
                longestStreak: award.longestStreak,
                lastPlayDate: null,
                dailyXp: 0,
                dailyXpDate: null,
                title: award.title,
                updatedAt: new Date().toISOString(),
            };
            notifyProgression(progression, award);
        }
        return award;
    }

    function getCached() {
        return cached || window.__USERTYPO_PROGRESSION__ || null;
    }

    function clearCache() {
        cached = null;
        window.__USERTYPO_PROGRESSION__ = null;
    }

    function formatLevelLabel(level) {
        return 'LVL ' + Math.max(1, Math.floor(Number(level) || 1));
    }

    function xpRemaining(progression) {
        if (!progression) return 0;
        return Math.max(0, (progression.xpToNext || 0) - (progression.xpIntoLevel || 0));
    }

    window.usertypoProgression = {
        xpNeededForLevel: xpNeededForLevel,
        levelTitle: levelTitle,
        computeLevelFromTotalXp: computeLevelFromTotalXp,
        percentToNext: percentToNext,
        normalizeProgression: normalizeProgression,
        normalizeAward: normalizeAward,
        estimateGuestXp: estimateGuestXp,
        getMine: getMine,
        getAwardForSession: getAwardForSession,
        getCached: getCached,
        clearCache: clearCache,
        formatLevelLabel: formatLevelLabel,
        xpRemaining: xpRemaining,
    };
})();
