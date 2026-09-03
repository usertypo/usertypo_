import { verifyToken } from '@clerk/backend';

const GUEST_ID_RE = /^guest_[a-z0-9-]{8,80}$/i;

export interface Env {
  ENVIRONMENT?: string;
  PUBLIC_SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  MULTIPLAYER_HUB: DurableObjectNamespace;
}

export interface Profile {
  userId: string;
  name: string;
  avatarUrl: string;
  level: number;
  percentToNext: number;
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

export async function authenticateHandshake(
  env: Env,
  auth: { token?: string; guestId?: string },
): Promise<{ userId: string; isGuest: boolean }> {
  const token = auth.token;
  if (token && typeof token === 'string') {
    const options: Record<string, unknown> = { secretKey: env.CLERK_SECRET_KEY };
    if (env.CLERK_JWT_KEY) options.jwtKey = env.CLERK_JWT_KEY.replace(/\\n/g, '\n');
    const parties = authorizedParties(env);
    if (parties.length) options.authorizedParties = parties;
    const verified = await verifyToken(token, options);
    if (!verified?.sub) throw new Error('invalid_token');
    return { userId: verified.sub, isGuest: false };
  }
  const guestId = String(auth.guestId || '').trim();
  if (!GUEST_ID_RE.test(guestId)) throw new Error('missing_token');
  return { userId: guestId.slice(0, 80), isGuest: true };
}

function xpNeededForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return Math.max(1, Math.floor(100 * (L ** 1.45)));
}

function percentToNext(xpInto: number, xpToNext: number): number {
  const into = Math.max(0, xpInto);
  const need = Math.max(1, xpToNext);
  return Math.max(0, Math.min(100, Math.round((into / need) * 1000) / 10));
}

function supabaseBase(env: Env): string {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '');
}

function anonHeaders(env: Env): Record<string, string> | null {
  const anon = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!anon) return null;
  return {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    'Content-Type': 'application/json',
  };
}

function serviceHeaders(env: Env): Record<string, string> | null {
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) return null;
  return {
    apikey: env.SUPABASE_ANON_KEY || key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function fetchProgressionViaRpc(
  env: Env,
  userId: string,
): Promise<{ level: number; xpInto: number } | null> {
  const base = supabaseBase(env);
  const headers = anonHeaders(env) || serviceHeaders(env);
  if (!base || !headers) return null;
  try {
    const res = await fetch(`${base}/rest/v1/rpc/get_public_progression_batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_user_ids: [userId] }),
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ level?: number; xp_into_level?: number }>;
    if (!Array.isArray(rows) || !rows[0]) return null;
    return {
      level: Math.max(1, Math.floor(Number(rows[0].level) || 1)),
      xpInto: Math.max(0, Math.floor(Number(rows[0].xp_into_level) || 0)),
    };
  } catch {
    return null;
  }
}

export async function getProfile(env: Env, userId: string): Promise<Profile> {
  if (String(userId).startsWith('guest_')) {
    return { userId, name: 'Guest', avatarUrl: '', level: 1, percentToNext: 0 };
  }
  const base = supabaseBase(env);
  const service = serviceHeaders(env);
  const anon = anonHeaders(env);
  if (!base || (!service && !anon)) {
    return { userId, name: 'Player', avatarUrl: '', level: 1, percentToNext: 0 };
  }

  let row: Record<string, unknown> = {};
  let prog: Record<string, unknown> = {};

  // Prefer service-role for profiles + progression; fall back to public RPC for levels.
  const primary = service || anon!;
  const [profileRes, progRes, rpcProg] = await Promise.all([
    fetch(
      `${base}/rest/v1/profiles?select=user_id,username,display_name,avatar_url&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers: primary },
    ).catch(() => null),
    service
      ? fetch(
        `${base}/rest/v1/user_progression?select=level,xp_into_level&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
        { headers: service },
      ).catch(() => null)
      : Promise.resolve(null),
    fetchProgressionViaRpc(env, userId),
  ]);

  if (profileRes && profileRes.ok) {
    const profiles = await profileRes.json() as unknown;
    if (Array.isArray(profiles) && profiles[0]) row = profiles[0] as Record<string, unknown>;
  }
  if (progRes && progRes.ok) {
    const progs = await progRes.json() as unknown;
    if (Array.isArray(progs) && progs[0]) prog = progs[0] as Record<string, unknown>;
  }

  let level = Math.max(1, Math.floor(Number(prog.level) || 1));
  let xpInto = Math.max(0, Math.floor(Number(prog.xp_into_level) || 0));
  if ((level <= 1 && xpInto <= 0) && rpcProg) {
    level = rpcProg.level;
    xpInto = rpcProg.xpInto;
  }

  const username = String(row.username || '').trim();
  // Always prefer the app username — never surface Google/OAuth display names.
  return {
    userId,
    name: username || 'Player',
    avatarUrl: String(row.avatar_url || ''),
    level,
    percentToNext: percentToNext(xpInto, xpNeededForLevel(level)),
  };
}

export async function areFriends(env: Env, userId: string, friendId: string): Promise<boolean> {
  if (String(userId).startsWith('guest_') || String(friendId).startsWith('guest_')) return false;
  const base = supabaseBase(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return env.ENVIRONMENT !== 'production';
  const res = await fetch(
    `${base}/rest/v1/friendships?select=user_id&user_id=eq.${encodeURIComponent(userId)}&friend_id=eq.${encodeURIComponent(friendId)}&limit=1`,
    { headers: { apikey: env.SUPABASE_ANON_KEY || key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json() as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

export async function areBlocked(env: Env, a: string, b: string): Promise<boolean> {
  if (String(a).startsWith('guest_') || String(b).startsWith('guest_')) return false;
  const base = supabaseBase(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return false;
  const res = await fetch(`${base}/rest/v1/rpc/_block_exists`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY || key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_a: a, p_b: b }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return !!data;
}

export async function hasBlocked(env: Env, blockerId: string, blockedId: string): Promise<boolean> {
  if (String(blockerId).startsWith('guest_') || String(blockedId).startsWith('guest_')) return false;
  const base = supabaseBase(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return false;
  const res = await fetch(
    `${base}/rest/v1/user_blocks?select=blocker_id&blocker_id=eq.${encodeURIComponent(blockerId)}&blocked_id=eq.${encodeURIComponent(blockedId)}&limit=1`,
    { headers: { apikey: env.SUPABASE_ANON_KEY || key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json() as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}
