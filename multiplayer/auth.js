'use strict';

const { verifyToken } = require('@clerk/backend');
const { createClient } = require('@supabase/supabase-js');

const GUEST_ID_RE = /^guest_[a-z0-9-]{8,80}$/i;

function createAuthServices(env, logger) {
    const authorizedParties = String(env.CLERK_AUTHORIZED_PARTIES || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    for (const extra of [env.RENDER_EXTERNAL_URL, env.PUBLIC_SITE_URL]) {
        const value = String(extra || '').trim().replace(/\/+$/, '');
        if (value && !authorizedParties.includes(value)) authorizedParties.push(value);
    }
    const verifyOptions = {
        secretKey: env.CLERK_SECRET_KEY,
    };
    if (env.CLERK_JWT_KEY) verifyOptions.jwtKey = env.CLERK_JWT_KEY.replace(/\\n/g, '\n');
    if (authorizedParties.length) verifyOptions.authorizedParties = authorizedParties;

    const supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        })
        : null;

    async function authenticateSocket(socket, next) {
        try {
            const handshakeAuth = (socket.handshake && socket.handshake.auth) || {};
            const token = handshakeAuth.token;
            if (token && typeof token === 'string') {
                const verified = await verifyToken(token, verifyOptions);
                if (!verified || !verified.sub) throw new Error('invalid_token');
                socket.data.userId = verified.sub;
                socket.data.sessionId = verified.sid || null;
                socket.data.isGuest = false;
                next();
                return;
            }

            const guestId = String(handshakeAuth.guestId || '').trim();
            if (!GUEST_ID_RE.test(guestId)) throw new Error('missing_token');
            socket.data.userId = guestId.slice(0, 80);
            socket.data.sessionId = null;
            socket.data.isGuest = true;
            next();
        } catch (error) {
            logger.warn('[multiplayer] rejected socket authentication:', error && error.message);
            const authError = new Error('Authentication required');
            authError.data = { code: 'unauthorized' };
            next(authError);
        }
    }

    function xpNeededForLevel(level) {
        const L = Math.max(1, Math.floor(Number(level) || 1));
        return Math.max(1, Math.floor(100 * (L ** 1.45)));
    }

    function percentToNext(xpInto, xpToNext) {
        const into = Math.max(0, Number(xpInto) || 0);
        const need = Math.max(1, Number(xpToNext) || 1);
        return Math.max(0, Math.min(100, Math.round((into / need) * 1000) / 10));
    }

    async function getProfile(userId) {
        if (String(userId || '').startsWith('guest_')) {
            return { userId, name: 'Guest', avatarUrl: '', level: 1, percentToNext: 0 };
        }
        if (!supabase) {
            return { userId, name: 'Player', avatarUrl: '', level: 1, percentToNext: 0 };
        }
        const [profileResult, progResult] = await Promise.all([
            supabase
                .from('profiles')
                .select('user_id,username,display_name,avatar_url')
                .eq('user_id', userId)
                .maybeSingle(),
            supabase
                .from('user_progression')
                .select('level, xp_into_level')
                .eq('user_id', userId)
                .maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        const row = profileResult.data || {};
        const prog = (!progResult.error && progResult.data) ? progResult.data : null;
        const level = Math.max(1, Math.floor(Number(prog && prog.level) || 1));
        const xpInto = Math.max(0, Math.floor(Number(prog && prog.xp_into_level) || 0));
        const xpToNext = xpNeededForLevel(level);
        return {
            userId,
            name: row.username || row.display_name || 'Player',
            avatarUrl: row.avatar_url || '',
            level,
            percentToNext: percentToNext(xpInto, xpToNext),
        };
    }

    async function areFriends(userId, friendId) {
        if (String(userId || '').startsWith('guest_') || String(friendId || '').startsWith('guest_')) {
            return false;
        }
        if (!supabase) {
            return env.NODE_ENV !== 'production' || env.ALLOW_UNVERIFIED_FRIENDS === 'true';
        }
        const result = await supabase
            .from('friendships')
            .select('user_id')
            .eq('user_id', userId)
            .eq('friend_id', friendId)
            .limit(1);
        if (result.error) throw result.error;
        return Array.isArray(result.data) && result.data.length > 0;
    }

    // One lean RPC either direction — used to reject duals.
    async function areBlocked(userId, otherUserId) {
        if (String(userId || '').startsWith('guest_') || String(otherUserId || '').startsWith('guest_')) {
            return false;
        }
        if (!supabase) return false;
        const result = await supabase.rpc('_block_exists', {
            p_a: userId,
            p_b: otherUserId,
        });
        if (result.error) throw result.error;
        return !!result.data;
    }

    // True when blockerId has blocked blockedId (one-way — hides blocker avatar from blocked).
    async function hasBlocked(blockerId, blockedId) {
        if (String(blockerId || '').startsWith('guest_') || String(blockedId || '').startsWith('guest_')) {
            return false;
        }
        if (!supabase) return false;
        const result = await supabase
            .from('user_blocks')
            .select('blocker_id')
            .eq('blocker_id', blockerId)
            .eq('blocked_id', blockedId)
            .limit(1);
        if (result.error) throw result.error;
        return Array.isArray(result.data) && result.data.length > 0;
    }

    // Owners among ownerIds who have blocked viewerId.
    async function blockersOf(viewerId, ownerIds) {
        const ids = (ownerIds || []).filter(Boolean);
        if (!ids.length || String(viewerId || '').startsWith('guest_') || !supabase) {
            return new Set();
        }
        const result = await supabase
            .from('user_blocks')
            .select('blocker_id')
            .eq('blocked_id', viewerId)
            .in('blocker_id', ids);
        if (result.error) throw result.error;
        return new Set((result.data || []).map((row) => row.blocker_id));
    }

    return {
        authenticateSocket,
        getProfile,
        areFriends,
        areBlocked,
        hasBlocked,
        blockersOf,
        hasSupabaseServiceRole: !!supabase,
    };
}

module.exports = { createAuthServices };
