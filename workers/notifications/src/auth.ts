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

export type FriendRequestRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  from_label?: string;
};

/**
 * Calls a Postgres function via PostgREST. friend_requests / friendships have no
 * direct table grants for signed-in users, so the Worker only uses the notify_* RPCs
 * (they scope results to auth.jwt() ->> 'sub', which requires the user's JWT).
 */
async function callRpc(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  userToken: string,
): Promise<unknown> {
  const base = supabaseBase(env);
  const headers = userSupabaseHeaders(env, userToken);
  if (!base || !headers) throw new Error('supabase_not_configured');

  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[notifications] supabase rpc failed', name, res.status, text.slice(0, 200));
    throw new Error('supabase_lookup_failed');
  }
  return res.json().catch(() => null);
}

function toFriendRequestRow(row: Record<string, unknown>): FriendRequestRow {
  const label = String(row.from_label || '').trim();
  return {
    id: String(row.id),
    from_user_id: String(row.from_user_id),
    to_user_id: String(row.to_user_id),
    status: String(row.status || ''),
    ...(label ? { from_label: label } : {}),
  };
}

export async function fetchFriendRequest(
  env: Env,
  requestId: string,
  userToken: string,
): Promise<FriendRequestRow | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) return null;
  const rows = await callRpc(env, 'notify_friend_request', { p_request_id: requestId }, userToken);
  const first = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
  return first ? toFriendRequestRow(first) : null;
}

export async function fetchPendingIncomingFriendRequests(
  env: Env,
  _userId: string,
  userToken: string,
): Promise<FriendRequestRow[]> {
  const rows = await callRpc(env, 'notify_pending_friend_requests', {}, userToken);
  return Array.isArray(rows)
    ? (rows as Record<string, unknown>[]).map(toFriendRequestRow)
    : [];
}

/** True if the signed-in caller (the JWT subject) is friends with `otherUserId`. */
export async function friendshipExists(
  env: Env,
  otherUserId: string,
  userToken: string,
): Promise<boolean> {
  const result = await callRpc(env, 'notify_is_friend', { p_other_user_id: otherUserId }, userToken);
  return result === true;
}

export async function profileDisplayLabel(
  env: Env,
  userId: string,
  userToken: string,
): Promise<string> {
  try {
    const label = await callRpc(env, 'profile_display_label', { p_user_id: userId }, userToken);
    const text = typeof label === 'string' ? label.trim() : '';
    return text || userId;
  } catch {
    return userId;
  }
}

export { bearerToken };
