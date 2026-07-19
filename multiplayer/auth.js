'use strict';

const { verifyToken } = require('@clerk/backend');
const { createClient } = require('@supabase/supabase-js');

function createAuthServices(env, logger) {
    const authorizedParties = String(env.CLERK_AUTHORIZED_PARTIES || env.RENDER_EXTERNAL_URL || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
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
            const token = socket.handshake.auth && socket.handshake.auth.token;
            if (!token || typeof token !== 'string') throw new Error('missing_token');
            const verified = await verifyToken(token, verifyOptions);
            if (!verified || !verified.sub) throw new Error('invalid_token');
            socket.data.userId = verified.sub;
            socket.data.sessionId = verified.sid || null;
            next();
        } catch (error) {
            logger.warn('[multiplayer] rejected socket authentication:', error && error.message);
            const authError = new Error('Authentication required');
            authError.data = { code: 'unauthorized' };
            next(authError);
        }
    }

    async function getProfile(userId) {
        if (!supabase) {
            return { userId, name: 'Player', avatarUrl: '' };
        }
        const result = await supabase
            .from('profiles')
            .select('user_id,username,display_name,avatar_url')
            .eq('user_id', userId)
            .maybeSingle();
        if (result.error) throw result.error;
        const row = result.data || {};
        return {
            userId,
            name: row.display_name || row.username || 'Player',
            avatarUrl: row.avatar_url || '',
        };
    }

    async function areFriends(userId, friendId) {
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

    return {
        authenticateSocket,
        getProfile,
        areFriends,
        hasSupabaseServiceRole: !!supabase,
    };
}

module.exports = { createAuthServices };
