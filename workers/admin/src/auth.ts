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
  /** Comma-separated profile public_ids allowed as admins */
  ADMIN_PUBLIC_IDS?: string;
}

export type AdminProfile = {
  user_id: string;
  public_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country_code: string | null;
  last_seen_at: string | null;
  is_banned: boolean;
  banned_at: string | null;
  banned_reason: string | null;
  show_on_leaderboard: boolean | null;
};

const DEFAULT_ADMIN_IDS = ['TE2CGW6Y', 'XRMXYTTF', 'D94QTBHG'];

export function adminPublicIds(env: Env): Set<string> {
  const raw = String(env.ADMIN_PUBLIC_IDS || '').trim();
  const list = (raw ? raw.split(',') : DEFAULT_ADMIN_IDS)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  return new Set(list.length ? list : DEFAULT_ADMIN_IDS);
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

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export type VerifiedSession = {
  userId: string;
  actorId: string | null;
  token: string;
};

export async function verifyClerkSession(env: Env, request: Request): Promise<VerifiedSession> {
  const token = bearerToken(request);
  if (!token) throw new Error('missing_token');

  let sub = '';
  let actorId: string | null = null;

  if (env.CLERK_SECRET_KEY || env.CLERK_JWT_KEY) {
    const options: Record<string, unknown> = {};
    if (env.CLERK_SECRET_KEY) options.secretKey = env.CLERK_SECRET_KEY;
    if (env.CLERK_JWT_KEY) options.jwtKey = env.CLERK_JWT_KEY.replace(/\\n/g, '\n');
    const parties = authorizedParties(env);
    if (parties.length) options.authorizedParties = parties;
    const verified = await verifyToken(token, options);
    if (!verified?.sub) throw new Error('invalid_token');
    sub = String(verified.sub);
    const act = (verified as { act?: { sub?: string } }).act;
    if (act && act.sub) actorId = String(act.sub);
  } else {
    const frontendApi = String(env.CLERK_FRONTEND_API || '').trim().replace(/^https?:\/\//, '');
    if (!frontendApi) throw new Error('clerk_not_configured');
    const JWKS = createRemoteJWKSet(new URL(`https://${frontendApi}/.well-known/jwks.json`));
    const parties = authorizedParties(env);
    const { payload } = await jwtVerify(token, JWKS, { clockTolerance: 10 });
    if (!payload?.sub) throw new Error('invalid_token');
    if (parties.length) {
      const azp = String(payload.azp || '');
      if (azp && !parties.includes(azp)) throw new Error('invalid_token');
    }
    sub = String(payload.sub);
    const act = payload.act as { sub?: string } | undefined;
    if (act && act.sub) actorId = String(act.sub);
  }

  return { userId: sub, actorId, token };
}

export function serviceHeaders(env: Env): Record<string, string> {
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) throw new Error('supabase_not_configured');
  return {
    apikey: String(env.SUPABASE_ANON_KEY || '').trim() || key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function supabaseBase(env: Env): string {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('supabase_not_configured');
  return base;
}

export async function supabaseRest<T = unknown>(
  env: Env,
  pathAndQuery: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${supabaseBase(env)}/rest/v1/${pathAndQuery}`;
  const headers = Object.assign({}, serviceHeaders(env), init?.headers || {});
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[admin] supabase', pathAndQuery, res.status, text.slice(0, 300));
    throw new Error('supabase_error_' + res.status);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

export async function supabaseRpc<T = unknown>(
  env: Env,
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${supabaseBase(env)}/rest/v1/rpc/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[admin] rpc', name, res.status, text.slice(0, 300));
    throw new Error('supabase_rpc_error_' + res.status);
  }
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

function mapProfile(row: Record<string, unknown>): AdminProfile {
  return {
    user_id: String(row.user_id || ''),
    public_id: String(row.public_id || '').toUpperCase(),
    username: row.username != null ? String(row.username) : null,
    display_name: row.display_name != null ? String(row.display_name) : null,
    avatar_url: row.avatar_url != null ? String(row.avatar_url) : null,
    country_code: row.country_code != null ? String(row.country_code) : null,
    last_seen_at: row.last_seen_at != null ? String(row.last_seen_at) : null,
    is_banned: row.is_banned === true,
    banned_at: row.banned_at != null ? String(row.banned_at) : null,
    banned_reason: row.banned_reason != null ? String(row.banned_reason) : null,
    show_on_leaderboard: row.show_on_leaderboard == null ? null : row.show_on_leaderboard !== false,
  };
}

const PROFILE_SELECT =
  'user_id,public_id,username,display_name,avatar_url,country_code,last_seen_at,is_banned,banned_at,banned_reason,show_on_leaderboard';

export async function fetchProfileByUserId(env: Env, userId: string): Promise<AdminProfile | null> {
  const rows = await supabaseRest<Record<string, unknown>[]>(
    env,
    `profiles?user_id=eq.${encodeURIComponent(userId)}&select=${PROFILE_SELECT}&limit=1`,
  );
  if (!Array.isArray(rows) || !rows[0]) return null;
  return mapProfile(rows[0]);
}

export async function fetchProfileByPublicId(env: Env, publicId: string): Promise<AdminProfile | null> {
  const id = publicId.trim().toUpperCase();
  const rows = await supabaseRest<Record<string, unknown>[]>(
    env,
    `profiles?public_id=eq.${encodeURIComponent(id)}&select=${PROFILE_SELECT}&limit=1`,
  );
  if (!Array.isArray(rows) || !rows[0]) return null;
  return mapProfile(rows[0]);
}

export async function requireAdmin(env: Env, request: Request): Promise<{
  session: VerifiedSession;
  admin: AdminProfile;
  effectiveAdminId: string;
}> {
  const session = await verifyClerkSession(env, request);
  // When impersonating, actor is the real admin; otherwise the session user.
  const effectiveAdminId = session.actorId || session.userId;
  const admin = await fetchProfileByUserId(env, effectiveAdminId);
  if (!admin || !adminPublicIds(env).has(admin.public_id)) {
    throw new Error('forbidden');
  }
  return { session, admin, effectiveAdminId };
}

export async function requireSignedIn(env: Env, request: Request): Promise<VerifiedSession> {
  return verifyClerkSession(env, request);
}

export async function writeAudit(
  env: Env,
  actorAdminId: string,
  action: string,
  targetUserId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseRest(env, 'admin_audit_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor_admin_id: actorAdminId,
        action,
        target_user_id: targetUserId,
        metadata,
      }),
    });
  } catch (err) {
    console.warn('[admin] audit write failed', err);
  }
}

export async function clerkApi(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const secret = String(env.CLERK_SECRET_KEY || '').trim();
  if (!secret) throw new Error('clerk_secret_missing');
  return fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: Object.assign(
      {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      init?.headers || {},
    ),
  });
}
