import { verifyToken } from '@clerk/backend';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Env {
  ENVIRONMENT?: string;
  PUBLIC_SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_FRONTEND_API?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  DB: D1Database;
}

function authorizedParties(env: Env): string[] {
  const fromEnv = String(env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const extra = String(env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  if (extra && !fromEnv.includes(extra)) fromEnv.push(extra);
  return fromEnv;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function requireUserId(env: Env, request: Request): Promise<string> {
  const token = bearerToken(request);
  if (!token) throw new Error('missing_token');

  // Prefer Clerk secret when configured (same as multiplayer worker).
  if (env.CLERK_SECRET_KEY || env.CLERK_JWT_KEY) {
    const options: Record<string, unknown> = {};
    if (env.CLERK_SECRET_KEY) options.secretKey = env.CLERK_SECRET_KEY;
    if (env.CLERK_JWT_KEY) options.jwtKey = env.CLERK_JWT_KEY.replace(/\\n/g, '\n');
    const parties = authorizedParties(env);
    if (parties.length) options.authorizedParties = parties;
    const verified = await verifyToken(token, options);
    if (!verified?.sub) throw new Error('invalid_token');
    return String(verified.sub);
  }

  // Staging-friendly fallback: verify against Clerk JWKS (no secret required).
  const frontendApi = String(env.CLERK_FRONTEND_API || '').trim().replace(/^https?:\/\//, '');
  if (!frontendApi) throw new Error('clerk_not_configured');
  const JWKS = createRemoteJWKSet(new URL(`https://${frontendApi}/.well-known/jwks.json`));
  const parties = authorizedParties(env);
  const { payload } = await jwtVerify(token, JWKS, {
    clockTolerance: 10,
  });
  if (!payload?.sub) throw new Error('invalid_token');
  if (parties.length) {
    const azp = String(payload.azp || '');
    if (azp && !parties.includes(azp)) throw new Error('invalid_token');
  }
  return String(payload.sub);
}

function supabaseBase(env: Env): string {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function userSupabaseHeaders(env: Env, userToken: string): Record<string, string> | null {
  const anon = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!anon || !userToken) return null;
  return {
    apikey: anon,
    Authorization: `Bearer ${userToken}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function serviceHeaders(env: Env): Record<string, string> | null {
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) return null;
  return {
    // Prefer anon as apikey (PostgREST convention) with service role as Bearer —
    // same pattern as the multiplayer worker.
    apikey: String(env.SUPABASE_ANON_KEY || '').trim() || key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

/** Prefer service role for trusted server lookups; fall back to the caller's Clerk JWT. */
function supabaseHeaders(env: Env, userToken?: string): Record<string, string> | null {
  return serviceHeaders(env) || (userToken ? userSupabaseHeaders(env, userToken) : null);
}

export type FriendRequestRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
};

async function fetchJsonRows(
  env: Env,
  pathAndQuery: string,
  userToken: string,
): Promise<Record<string, unknown>[]> {
  const base = supabaseBase(env);
  const preferred = supabaseHeaders(env, userToken);
  if (!base || !preferred) throw new Error('supabase_not_configured');

  const url = `${base}/rest/v1/${pathAndQuery}`;
  let res = await fetch(url, { headers: preferred });

  // Service role preferred; if it fails and a user JWT is available, retry once.
  if (!res.ok && serviceHeaders(env) && userToken) {
    const userHeaders = userSupabaseHeaders(env, userToken);
    if (userHeaders) {
      console.warn('[notifications] supabase fetch failed with service role', res.status, '— retrying with user JWT');
      res = await fetch(url, { headers: userHeaders });
    }
  }

  if (!res.ok) {
    console.warn('[notifications] supabase fetch failed', pathAndQuery, res.status);
    throw new Error('supabase_lookup_failed');
  }
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
}

export async function fetchFriendRequest(
  env: Env,
  requestId: string,
  userToken: string,
): Promise<FriendRequestRow | null> {
  const rows = await fetchJsonRows(
    env,
    `friend_requests?id=eq.${encodeURIComponent(requestId)}&select=id,from_user_id,to_user_id,status&limit=1`,
    userToken,
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: String(row.id),
    from_user_id: String(row.from_user_id),
    to_user_id: String(row.to_user_id),
    status: String(row.status || ''),
  };
}

export async function fetchPendingIncomingFriendRequests(
  env: Env,
  userId: string,
  userToken: string,
): Promise<FriendRequestRow[]> {
  const rows = await fetchJsonRows(
    env,
    `friend_requests?to_user_id=eq.${encodeURIComponent(userId)}`
      + `&status=eq.pending&select=id,from_user_id,to_user_id,status&order=created_at.desc&limit=50`,
    userToken,
  );
  return rows.map((row) => ({
    id: String(row.id),
    from_user_id: String(row.from_user_id),
    to_user_id: String(row.to_user_id),
    status: String(row.status || 'pending'),
  }));
}

export async function friendshipExists(
  env: Env,
  userA: string,
  userB: string,
  userToken: string,
): Promise<boolean> {
  const rows = await fetchJsonRows(
    env,
    `friendships?user_id=eq.${encodeURIComponent(userA)}`
      + `&friend_id=eq.${encodeURIComponent(userB)}&select=user_id&limit=1`,
    userToken,
  );
  return rows.length > 0;
}

export async function profileDisplayLabel(
  env: Env,
  userId: string,
  userToken: string,
): Promise<string> {
  try {
    const rows = await fetchJsonRows(
      env,
      `profiles?user_id=eq.${encodeURIComponent(userId)}`
        + `&select=username,display_name,user_id&limit=1`,
      userToken,
    );
    if (!rows[0]) return userId;
    const row = rows[0];
    const username = String(row.username || '').trim();
    const display = String(row.display_name || '').trim();
    return username || display || String(row.user_id || userId);
  } catch {
    return userId;
  }
}

export { bearerToken };
