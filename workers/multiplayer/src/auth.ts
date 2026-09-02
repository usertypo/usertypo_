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

export async function getProfile(env: Env, userId: string): Promise<Profile> {
  if (String(userId).startsWith('guest_')) {
    return { userId, name: 'Guest', avatarUrl: '', level: 1, percentToNext: 0 };
  }
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return { userId, name: 'Player', avatarUrl: '', level: 1, percentToNext: 0 };
  }
  const headers = {
    apikey: env.SUPABASE_ANON_KEY || key,
    Authorization: `Bearer ${key}`,
  };
  const [profileRes, progRes] = await Promise.all([
    fetch(`${base}/rest/v1/profiles?select=user_id,username,display_name,avatar_url&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers }),
    fetch(`${base}/rest/v1/user_progression?select=level,xp_into_level&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers }),
  ]);
  let row: Record<string, unknown> = {};
  if (profileRes.ok) {
    const profiles = await profileRes.json() as unknown;
    if (Array.isArray(profiles) && profiles[0]) row = profiles[0] as Record<string, unknown>;
  }
  let prog: Record<string, unknown> = {};
  if (progRes.ok) {
    const progs = await progRes.json() as unknown;
    if (Array.isArray(progs) && progs[0]) prog = progs[0] as Record<string, unknown>;
  }
  const level = Math.max(1, Math.floor(Number(prog.level) || 1));
  const xpInto = Math.max(0, Math.floor(Number(prog.xp_into_level) || 0));
  const displayName = String(row.display_name || '').trim();
  const username = String(row.username || '').trim();
  return {
    userId,
    name: displayName || username || 'Player',
    avatarUrl: String(row.avatar_url || ''),
    level,
    percentToNext: percentToNext(xpInto, xpNeededForLevel(level)),
  };
}

export async function areFriends(env: Env, userId: string, friendId: string): Promise<boolean> {
  if (String(userId).startsWith('guest_') || String(friendId).startsWith('guest_')) return false;
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
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
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
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
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return false;
  const res = await fetch(
    `${base}/rest/v1/user_blocks?select=blocker_id&blocker_id=eq.${encodeURIComponent(blockerId)}&blocked_id=eq.${encodeURIComponent(blockedId)}&limit=1`,
    { headers: { apikey: env.SUPABASE_ANON_KEY || key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json() as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}
