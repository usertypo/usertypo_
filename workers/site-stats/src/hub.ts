/**
 * Durable Object: guest community aggregates for the About page.
 * Counters: tests, total_seconds, total_words, and 30s timed WPM histogram.
 */
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  SITE_STATS: DurableObjectNamespace;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  ALLOWED_ORIGINS?: string;
  SIGNED_IN_CACHE_MS?: string;
  ENVIRONMENT?: string;
}

export type GuestAggregates = {
  tests_taken: number;
  total_seconds: number;
  total_words: number;
  hist30: {
    bins: Array<{ start: number; end: number; count: number }>;
    total: number;
    average: number | null;
    min: number | null;
    max: number | null;
    maxCount: number;
  };
};

const MAX_WPM = 500;
const MIN_INGEST_INTERVAL_MS = 1500;

export class SiteStatsHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        key TEXT PRIMARY KEY,
        value REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS hist30 (
        bucket_start INTEGER PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rate_limit (
        ip TEXT PRIMARY KEY,
        last_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  private getCounter(key: string): number {
    const row = this.ctx.storage.sql
      .exec<{ value: number }>('SELECT value FROM counters WHERE key = ?', key)
      .toArray()[0];
    return row ? Number(row.value) || 0 : 0;
  }

  private addCounter(key: string, delta: number) {
    this.ctx.storage.sql.exec(
      `INSERT INTO counters (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`,
      key,
      delta,
    );
  }

  private buildHist30(): GuestAggregates['hist30'] {
    const rows = this.ctx.storage.sql
      .exec<{ bucket_start: number; count: number }>(
        'SELECT bucket_start, count FROM hist30 ORDER BY bucket_start ASC',
      )
      .toArray();

    const total = this.getCounter('hist30_total');
    const sum = this.getCounter('hist30_sum');
    const min = this.getCounter('hist30_min');
    const max = this.getCounter('hist30_max');

    if (!rows.length || total <= 0) {
      return {
        bins: [],
        total: 0,
        average: null,
        min: null,
        max: null,
        maxCount: 0,
      };
    }

    const bins = rows.map((row) => ({
      start: Number(row.bucket_start),
      end: Number(row.bucket_start) + 5,
      count: Number(row.count) || 0,
    }));
    const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);

    return {
      bins,
      total,
      average: Math.round((sum / total) * 10) / 10,
      min: min > 0 ? Math.round(min * 10) / 10 : null,
      max: max > 0 ? Math.round(max * 10) / 10 : null,
      maxCount,
    };
  }

  getGuestAggregates(): GuestAggregates {
    return {
      tests_taken: Math.floor(this.getCounter('tests_taken')),
      total_seconds: Math.floor(this.getCounter('total_seconds')),
      total_words: Math.floor(this.getCounter('total_words')),
      hist30: this.buildHist30(),
    };
  }

  ingest(input: {
    ip: string;
    duration_seconds: number;
    words: number;
    wpm: number | null;
    mode: string;
    amount: number;
  }): { ok: true } | { ok: false; error: string } {
    const now = Date.now();
    const ip = String(input.ip || 'unknown').slice(0, 80);
    const last = this.ctx.storage.sql
      .exec<{ last_ms: number }>('SELECT last_ms FROM rate_limit WHERE ip = ?', ip)
      .toArray()[0];
    if (last && now - Number(last.last_ms) < MIN_INGEST_INTERVAL_MS) {
      return { ok: false, error: 'rate_limited' };
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_limit (ip, last_ms) VALUES (?, ?)
       ON CONFLICT(ip) DO UPDATE SET last_ms = excluded.last_ms`,
      ip,
      now,
    );

    const duration = Math.max(0, Math.min(3600, Math.round(Number(input.duration_seconds) || 0)));
    const words = Math.max(0, Math.min(50_000, Math.round(Number(input.words) || 0)));
    if (duration < 1 && words < 1) {
      return { ok: false, error: 'empty' };
    }

    this.addCounter('tests_taken', 1);
    this.addCounter('total_seconds', duration);
    this.addCounter('total_words', words);

    const mode = String(input.mode || '');
    const amount = Math.round(Number(input.amount) || 0);
    const wpm = Number(input.wpm);
    if (
      mode === 'time'
      && amount === 30
      && Number.isFinite(wpm)
      && wpm > 0
      && wpm <= MAX_WPM
    ) {
      const bucket = Math.floor(wpm / 5) * 5;
      this.ctx.storage.sql.exec(
        `INSERT INTO hist30 (bucket_start, count) VALUES (?, 1)
         ON CONFLICT(bucket_start) DO UPDATE SET count = count + 1`,
        bucket,
      );
      this.addCounter('hist30_total', 1);
      this.addCounter('hist30_sum', wpm);
      const curMin = this.getCounter('hist30_min');
      const curMax = this.getCounter('hist30_max');
      if (curMin <= 0 || wpm < curMin) {
        this.ctx.storage.sql.exec(
          `INSERT INTO counters (key, value) VALUES ('hist30_min', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          wpm,
        );
      }
      if (wpm > curMax) {
        this.ctx.storage.sql.exec(
          `INSERT INTO counters (key, value) VALUES ('hist30_max', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          wpm,
        );
      }
    }

    return { ok: true };
  }

  getCachedSignedIn(): { payload: unknown; updated_at: number } | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string; updated_at: number }>(
        "SELECT value, updated_at FROM cache WHERE key = 'signed_in_stats'",
      )
      .toArray()[0];
    if (!row) return null;
    try {
      return { payload: JSON.parse(row.value), updated_at: Number(row.updated_at) || 0 };
    } catch {
      return null;
    }
  }

  setCachedSignedIn(payload: unknown) {
    this.ctx.storage.sql.exec(
      `INSERT INTO cache (key, value, updated_at) VALUES ('signed_in_stats', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify(payload),
      Date.now(),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/guest') {
      return Response.json(this.getGuestAggregates());
    }
    if (url.pathname === '/ingest' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
      const result = this.ingest({
        ip: String(body.ip || ''),
        duration_seconds: Number(body.duration_seconds),
        words: Number(body.words),
        wpm: body.wpm == null ? null : Number(body.wpm),
        mode: String(body.mode || ''),
        amount: Number(body.amount),
      });
      return Response.json(result, { status: result.ok ? 200 : 429 });
    }
    if (url.pathname === '/cache/signed-in') {
      if (request.method === 'GET') {
        return Response.json(this.getCachedSignedIn());
      }
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (body == null) return Response.json({ ok: false }, { status: 400 });
        this.setCachedSignedIn(body);
        return Response.json({ ok: true });
      }
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
}
