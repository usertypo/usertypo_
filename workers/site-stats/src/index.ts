/**
 * usertypo_ Site Stats Worker
 * - POST /ingest  — guest test aggregates (time, tests, words, 30s WPM hist)
 * - GET  /public  — About page: guest DO + signed-in Supabase (cached ~60s)
 */
import { SiteStatsHub, type Env, type GuestAggregates } from './hub';

export { SiteStatsHub };

type Hist = GuestAggregates['hist30'];

const DEFAULT_ORIGINS = [
  'https://usertypo.com',
  'https://www.usertypo.com',
  'https://usertypo.pages.dev',
  'https://dev.usertypo.com',
  'https://dev.usertypo.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

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
  headers['Access-Control-Allow-Headers'] = 'content-type, authorization';
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
}

function json(env: Env, status: number, body: unknown, request?: Request): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  applyCors(env, request, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  );
}

function emptyHist(): Hist {
  return { bins: [], total: 0, average: null, min: null, max: null, maxCount: 0 };
}

function asHist(value: unknown): Hist {
  if (!value || typeof value !== 'object') return emptyHist();
  const v = value as Record<string, unknown>;
  const binsRaw = Array.isArray(v.bins) ? v.bins : [];
  const bins = binsRaw
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        start: Math.round(Number(r.start) || 0),
        end: Math.round(Number(r.end) || 0),
        count: Math.max(0, Math.round(Number(r.count) || 0)),
      };
    })
    .filter((b) => b.end > b.start);
  const total = Math.max(0, Math.round(Number(v.total) || 0));
  const average = v.average == null ? null : Number(v.average);
  const min = v.min == null ? null : Number(v.min);
  const max = v.max == null ? null : Number(v.max);
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);
  return {
    bins,
    total,
    average: average != null && Number.isFinite(average) ? average : null,
    min: min != null && Number.isFinite(min) ? min : null,
    max: max != null && Number.isFinite(max) ? max : null,
    maxCount,
  };
}

function mergeHist(a: Hist, b: Hist): Hist {
  const map = new Map<number, number>();
  for (const bin of a.bins) map.set(bin.start, (map.get(bin.start) || 0) + bin.count);
  for (const bin of b.bins) map.set(bin.start, (map.get(bin.start) || 0) + bin.count);
  const starts = Array.from(map.keys()).sort((x, y) => x - y);
  const bins = starts.map((start) => ({
    start,
    end: start + 5,
    count: map.get(start) || 0,
  }));
  const total = a.total + b.total;
  if (!total) return emptyHist();

  let sum = 0;
  let weight = 0;
  if (a.average != null && a.total > 0) {
    sum += a.average * a.total;
    weight += a.total;
  }
  if (b.average != null && b.total > 0) {
    sum += b.average * b.total;
    weight += b.total;
  }
  const mins = [a.min, b.min].filter((n): n is number => n != null && Number.isFinite(n));
  const maxes = [a.max, b.max].filter((n): n is number => n != null && Number.isFinite(n));
  return {
    bins,
    total,
    average: weight > 0 ? Math.round((sum / weight) * 10) / 10 : null,
    min: mins.length ? Math.min(...mins) : null,
    max: maxes.length ? Math.max(...maxes) : null,
    maxCount: bins.reduce((m, bin) => Math.max(m, bin.count), 0),
  };
}

async function fetchSignedInStats(env: Env): Promise<Record<string, unknown> | null> {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_ANON_KEY || '');
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/rpc/get_public_site_stats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: '{}',
  });
  if (!res.ok) {
    console.warn('[site-stats] supabase rpc failed', res.status);
    return null;
  }
  const data = await res.json().catch(() => null);
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function hubStub(env: Env) {
  const id = env.SITE_STATS.idFromName('global');
  return env.SITE_STATS.get(id);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      // Match leaderboards: never return 204 with a body (Workers runtime 500s).
      const headers: Record<string, string> = {};
      applyCors(env, request, headers);
      return new Response('ok', { headers });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json(env, 200, { ok: true, service: 'usertypo-site-stats' }, request);
    }

    const stub = hubStub(env);

    if (url.pathname === '/ingest' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return json(env, 400, { ok: false, error: 'invalid_json' }, request);
      if (body.failed) return json(env, 200, { ok: true, skipped: true, reason: 'failed' }, request);

      const duration = Math.round(Number(body.duration_seconds) || 0);
      const words = Math.round(Number(body.words) || 0);
      const wpm = body.wpm == null ? null : Number(body.wpm);
      const mode = String(body.mode || '');
      const amount = Math.round(Number(body.amount) || 0);

      if (duration < 1 && words < 1) {
        return json(env, 400, { ok: false, error: 'empty' }, request);
      }
      if (wpm != null && (!Number.isFinite(wpm) || wpm < 0 || wpm > 500)) {
        return json(env, 400, { ok: false, error: 'invalid_wpm' }, request);
      }

      const doRes = await stub.fetch(new Request('https://do/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: clientIp(request),
          duration_seconds: duration,
          words,
          wpm,
          mode,
          amount,
        }),
      }));
      const payload = await doRes.json().catch(() => ({ ok: false, error: 'do_error' }));
      return json(env, doRes.status, payload, request);
    }

    if (url.pathname === '/public' && request.method === 'GET') {
      const guestRes = await stub.fetch('https://do/guest');
      const guest = (await guestRes.json().catch(() => null)) as GuestAggregates | null;
      const guestSafe: GuestAggregates = guest || {
        tests_taken: 0,
        total_seconds: 0,
        total_words: 0,
        hist30: emptyHist(),
      };

      const cacheMs = Math.max(5_000, Number(env.SIGNED_IN_CACHE_MS) || 60_000);
      const cachedRes = await stub.fetch('https://do/cache/signed-in');
      const cached = await cachedRes.json().catch(() => null) as
        | { payload: Record<string, unknown>; updated_at: number }
        | null;

      let signedIn: Record<string, unknown> | null = null;
      if (cached && cached.payload && Date.now() - Number(cached.updated_at || 0) < cacheMs) {
        signedIn = cached.payload;
      } else {
        signedIn = await fetchSignedInStats(env);
        if (signedIn) {
          await stub.fetch(new Request('https://do/cache/signed-in', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signedIn),
          }));
        } else if (cached && cached.payload) {
          signedIn = cached.payload;
        }
      }

      const totalsIn = (signedIn && typeof signedIn.totals === 'object' && signedIn.totals)
        ? signedIn.totals as Record<string, unknown>
        : {};

      const merged = {
        totals: {
          users: Math.max(0, Math.round(Number(totalsIn.users) || 0)),
          tests_taken:
            Math.max(0, Math.round(Number(totalsIn.tests_taken) || 0)) + guestSafe.tests_taken,
          tests_completed:
            Math.max(0, Math.round(Number(totalsIn.tests_completed) || 0)) + guestSafe.tests_taken,
          total_seconds:
            Math.max(0, Math.round(Number(totalsIn.total_seconds) || 0)) + guestSafe.total_seconds,
          total_words:
            Math.max(0, Math.round(Number(totalsIn.total_words) || 0)) + guestSafe.total_words,
          avg_wpm: totalsIn.avg_wpm ?? null,
          avg_accuracy: totalsIn.avg_accuracy ?? null,
          personal_bests: Math.max(0, Math.round(Number(totalsIn.personal_bests) || 0)),
          tests_30s:
            Math.max(0, Math.round(Number(totalsIn.tests_30s) || 0)) + guestSafe.hist30.total,
        },
        countries: signedIn?.countries || { items: [], other: 0, total_users_with_country: 0 },
        score_distribution_30s: mergeHist(
          asHist(signedIn?.score_distribution_30s),
          guestSafe.hist30,
        ),
        activity: signedIn?.activity || [],
        popular_modes: signedIn?.popular_modes || [],
        languages: signedIn?.languages || { items: [], other: 0 },
        generated_at: new Date().toISOString(),
        sources: {
          signed_in: !!signedIn,
          guest: true,
        },
      };

      return json(env, 200, merged, request);
    }

    return json(env, 404, { error: 'not_found' }, request);
  },
};
