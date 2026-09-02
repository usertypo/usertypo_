/**
 * usertypo_ Leaderboards Worker — Postgres-only (Supabase RPCs).
 * Replaces the Supabase Edge Function + Upstash Redis stack.
 *
 * POST JSON actions (same contract as the old edge function):
 *   { action: "top", mode, amount, timeframe, limit }
 *   { action: "rank", mode, amount, timeframe }
 *   { action: "ingest", session_id }
 *   { action: "set_visibility", show_on_leaderboard }
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Comma-separated browser origins allowed for CORS */
  ALLOWED_ORIGINS?: string;
}

type Timeframe = 'alltime' | 'daily' | 'weekly';
type Mode = 'time' | 'words';

const ALLTIME_MIN_TESTS = 50;
const ALLTIME_MIN_WPM = 30;
const MIN_ACCURACY = 75;
const MAX_INGEST_WPM = 500;
const MAX_INGEST_AGE_MS = 60 * 60 * 1000;

const BOARD_COMBOS: Array<{ mode: Mode; amount: number }> = [
  { mode: 'time', amount: 15 },
  { mode: 'time', amount: 30 },
  { mode: 'time', amount: 60 },
  { mode: 'time', amount: 120 },
  { mode: 'words', amount: 10 },
  { mode: 'words', amount: 25 },
  { mode: 'words', amount: 50 },
  { mode: 'words', amount: 100 },
];

const DEFAULT_ORIGINS = [
  'https://usertypo.com',
  'https://www.usertypo.com',
  'https://usertypo.pages.dev',
  'https://dev.usertypo.com',
  'https://dev.usertypo.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function json(env: Env, status: number, body: unknown, request?: Request): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  applyCors(env, request, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function parseOrigins(env: Env): string[] {
  const fromEnv = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

function applyCors(env: Env, request: Request | undefined, headers: Record<string, string>) {
  const origin = request?.headers.get('Origin') || '';
  if (origin && parseOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  headers['Access-Control-Allow-Headers'] =
    'authorization, x-client-info, apikey, content-type';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
}

function normalizeMode(value: unknown): Mode {
  return value === 'words' ? 'words' : 'time';
}

function normalizeTimeframe(value: unknown): Timeframe {
  if (value === 'daily' || value === 'weekly' || value === 'alltime') return value;
  return 'alltime';
}

function supabaseBase(env: Env): string {
  return String(env.SUPABASE_URL || '').replace(/\/+$/, '');
}

async function supabaseRpc<T>(
  env: Env,
  rpcName: string,
  body: Record<string, unknown>,
  authHeader: string | null,
): Promise<T> {
  const base = supabaseBase(env);
  if (!base || !env.SUPABASE_ANON_KEY) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const authorization = authHeader && authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader
    : `Bearer ${env.SUPABASE_ANON_KEY}`;

  const res = await fetch(`${base}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message = typeof data === 'object' && data && 'message' in data
      ? String((data as { message?: string }).message)
      : `RPC ${rpcName} failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

async function supabaseServiceGet<T>(
  env: Env,
  path: string,
  query: string,
): Promise<T | null> {
  const base = supabaseBase(env);
  const res = await fetch(`${base}/rest/v1/${path}?${query}`, {
    method: 'GET',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase GET failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const rows = await res.json() as T[];
  return rows[0] ?? null;
}

async function supabaseServiceCount(env: Env, userId: string): Promise<number> {
  const base = supabaseBase(env);
  const query = new URLSearchParams({
    select: 'id',
    user_id: `eq.${userId}`,
    failed: 'eq.false',
  });
  const res = await fetch(`${base}/rest/v1/typing_sessions?${query}`, {
    method: 'HEAD',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) return 0;
  const range = res.headers.get('content-range') || '';
  const match = /\/(\d+)$/.exec(range);
  return match ? Number(match[1]) : 0;
}

async function requireCallerProfile(env: Env, authHeader: string | null) {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: json(env, 401, { error: 'missing_auth' }) };
  }

  const base = supabaseBase(env);
  const res = await fetch(`${base}/rest/v1/profiles?select=user_id,username,avatar_url,show_on_leaderboard&limit=1`, {
    method: 'GET',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authHeader,
    },
  });

  if (!res.ok) {
    return { error: json(env, 401, { error: 'auth_failed' }) };
  }

  const rows = await res.json() as Array<{
    user_id?: string;
    username?: string | null;
    avatar_url?: string | null;
    show_on_leaderboard?: boolean | null;
  }>;
  const profile = rows[0];
  if (!profile?.user_id) {
    return { error: json(env, 401, { error: 'profile_required' }) };
  }
  return { profile };
}

async function handleTop(env: Env, body: Record<string, unknown>, authHeader: string | null, request: Request) {
  const mode = normalizeMode(body.mode);
  const amount = Math.max(1, Math.round(Number(body.amount) || 30));
  const timeframe = normalizeTimeframe(body.timeframe);
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 50));

  const rows = await supabaseRpc<Array<Record<string, unknown>>>(env, 'get_leaderboard', {
    p_mode: mode,
    p_amount: amount,
    p_timeframe: timeframe,
    p_limit: limit,
  }, authHeader);

  const entries = (rows || []).map((row) => ({
    rank: Number(row.rank) || 0,
    user_id: row.user_id,
    username: row.username || 'Player',
    avatar_url: row.avatar_url || null,
    country_code: row.country_code || null,
    wpm: row.wpm == null ? 0 : Number(row.wpm),
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    raw_wpm: row.raw_wpm == null ? null : Number(row.raw_wpm),
    consistency: row.consistency == null ? null : Number(row.consistency),
    session_created_at: row.session_created_at || null,
  }));

  return json(env, 200, {
    source: 'postgres',
    mode,
    amount,
    timeframe,
    limit,
    entries,
  }, request);
}

async function handleRank(env: Env, body: Record<string, unknown>, authHeader: string | null, request: Request) {
  const auth = await requireCallerProfile(env, authHeader);
  if (auth.error) return auth.error;

  const mode = normalizeMode(body.mode);
  const amount = Math.max(1, Math.round(Number(body.amount) || 30));
  const timeframe = normalizeTimeframe(body.timeframe);

  const rows = await supabaseRpc<Array<Record<string, unknown>>>(env, 'get_my_leaderboard_rank', {
    p_mode: mode,
    p_amount: amount,
    p_timeframe: timeframe,
  }, authHeader);

  const row = rows && rows[0];
  if (!row || row.rank == null) {
    return json(env, 200, {
      source: 'postgres',
      rank: null,
      wpm: null,
      accuracy: null,
      totalPlayers: 0,
    }, request);
  }

  return json(env, 200, {
    source: 'postgres',
    rank: Number(row.rank),
    wpm: row.wpm == null ? null : Number(row.wpm),
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    totalPlayers: row.total_players == null ? 0 : Number(row.total_players),
  }, request);
}

async function handleIngest(env: Env, body: Record<string, unknown>, authHeader: string | null, request: Request) {
  const auth = await requireCallerProfile(env, authHeader);
  if (auth.error) return auth.error;

  if (auth.profile.show_on_leaderboard === false) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'opted_out' }, request);
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
  if (!sessionId) {
    return json(env, 400, { error: 'session_id_required' }, request);
  }

  const userId = auth.profile.user_id;
  const session = await supabaseServiceGet<{
    id: string;
    user_id: string;
    mode: string;
    amount: number;
    wpm: number;
    raw_wpm: number | null;
    accuracy: number | null;
    consistency: number | null;
    created_at: string;
    failed: boolean;
  }>(env, 'typing_sessions', new URLSearchParams({
    select: 'id,user_id,mode,amount,wpm,raw_wpm,accuracy,consistency,created_at,failed',
    id: `eq.${sessionId}`,
    limit: '1',
  }).toString());

  if (!session) {
    return json(env, 404, { error: 'session_not_found' }, request);
  }
  if (session.user_id !== userId) {
    return json(env, 403, { error: 'forbidden_session' }, request);
  }
  if (session.failed) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'failed_test' }, request);
  }

  const mode = normalizeMode(session.mode);
  const amount = Math.max(1, Math.round(Number(session.amount) || 1));
  if (!BOARD_COMBOS.some((c) => c.mode === mode && c.amount === amount)) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'unsupported_combo' }, request);
  }

  const wpm = Number(session.wpm);
  if (!isFinite(wpm) || wpm <= 0) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'invalid_wpm' }, request);
  }
  if (wpm > MAX_INGEST_WPM) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'wpm_cap' }, request);
  }

  const sessionAccuracy = session.accuracy == null ? null : Number(session.accuracy);
  if (sessionAccuracy != null && isFinite(sessionAccuracy) && sessionAccuracy < MIN_ACCURACY) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'low_accuracy' }, request);
  }

  const createdAt = session.created_at || new Date().toISOString();
  const at = new Date(createdAt);
  if (!isFinite(at.getTime()) || (Date.now() - at.getTime()) > MAX_INGEST_AGE_MS) {
    return json(env, 200, { source: 'postgres', skipped: true, reason: 'session_too_old' }, request);
  }

  const completedTests = await supabaseServiceCount(env, userId);
  const qualifiesAlltime = completedTests >= ALLTIME_MIN_TESTS
    && wpm >= ALLTIME_MIN_WPM
    && !(sessionAccuracy != null && isFinite(sessionAccuracy) && sessionAccuracy < MIN_ACCURACY);

  // Score is already persisted in typing_sessions; Postgres RPCs read it directly.
  return json(env, 200, {
    source: 'postgres',
    skipped: false,
    updated: qualifiesAlltime,
    daily_updated: true,
    weekly_updated: true,
    alltime_eligible: qualifiesAlltime,
    completed_tests: completedTests,
    user_id: userId,
    session_id: sessionId,
    mode,
    amount,
    wpm,
  }, request);
}

async function handleSetVisibility(env: Env, body: Record<string, unknown>, authHeader: string | null, request: Request) {
  const auth = await requireCallerProfile(env, authHeader);
  if (auth.error) return auth.error;

  const show = body.show_on_leaderboard !== false && body.show_on_leaderboard !== 'false';
  const userId = auth.profile.user_id;
  const base = supabaseBase(env);

  const res = await fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authHeader || '',
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ show_on_leaderboard: show }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`profile_update_failed: ${text.slice(0, 200)}`);
  }

  return json(env, 200, {
    source: 'postgres',
    show_on_leaderboard: show,
    postgres: show ? 'visible' : 'hidden',
  }, request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {};
      applyCors(env, request, headers);
      return new Response('ok', { headers });
    }

    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return json(env, 200, { ok: true, service: 'usertypo-leaderboards' }, request);
    }

    if (request.method === 'GET' && new URL(request.url).pathname === '/') {
      return json(env, 200, {
        ok: true,
        service: 'usertypo-leaderboards',
        hint: 'This API accepts POST JSON only. Try GET /health or use the leaderboards page on dev.usertypo.com.',
      }, request);
    }

    if (request.method !== 'POST') {
      return json(env, 405, { error: 'method_not_allowed' }, request);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json(env, 400, { error: 'invalid_json' }, request);
    }

    const action = String(body.action || '');
    const authHeader = request.headers.get('Authorization');

    try {
      if (action === 'top') return await handleTop(env, body, authHeader, request);
      if (action === 'rank') return await handleRank(env, body, authHeader, request);
      if (action === 'ingest') return await handleIngest(env, body, authHeader, request);
      if (action === 'set_visibility') return await handleSetVisibility(env, body, authHeader, request);
      return json(env, 400, { error: 'unknown_action' }, request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[leaderboards]', message);
      return json(env, 500, { error: 'leaderboard_failed', details: message }, request);
    }
  },
};
