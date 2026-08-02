/**
 * Leaderboards Edge Function — Upstash Redis ZSET rankings + profile hydration.
 *
 * Actions (POST JSON):
 *   { action: "top", mode, amount, timeframe, limit }
 *   { action: "rank", mode, amount, timeframe }
 *   { action: "ingest", session_id }  // scores loaded from Postgres (not trusted from client)
 *   { action: "set_visibility", show_on_leaderboard }
 *
 * Rules:
 * - Timeframes: alltime | daily | weekly (monthly removed)
 * - All-time requires >= 50 completed (non-failed) tests AND wpm >= 30
 * - Daily/weekly have no min-test / min-wpm gates (only valid successful score)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Timeframe = "alltime" | "daily" | "weekly";
type Mode = "time" | "words";

const ALLTIME_MIN_TESTS = 50;
const ALLTIME_MIN_WPM = 30;
/** Soft ceiling aligned with multiplayer anti-cheat (+ headroom). */
const MAX_INGEST_WPM = 500;
/** Ignore stale ingest replays of old session rows. */
const MAX_INGEST_AGE_MS = 60 * 60 * 1000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function redisConfigured() {
  return !!(
    Deno.env.get("UPSTASH_REDIS_REST_URL") &&
    Deno.env.get("UPSTASH_REDIS_REST_TOKEN")
  );
}

async function redisCommand(args: Array<string | number>) {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) throw new Error("REDIS_NOT_CONFIGURED");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const payload = await res.json();
  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Redis HTTP ${res.status}`);
  }
  return payload.result;
}

async function redisPipeline(commands: Array<Array<string | number>>) {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) throw new Error("REDIS_NOT_CONFIGURED");

  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  const payload = await res.json();
  if (!res.ok) throw new Error(`Redis pipeline HTTP ${res.status}`);
  return payload as Array<{ result?: unknown; error?: string }>;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function utcParts(date = new Date()) {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

function isoWeekKey(date = new Date()) {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${pad2(week)}`;
}

function boardKey(mode: Mode, amount: number, timeframe: Timeframe, at = new Date()) {
  const base = `lb:v1:${mode}:${amount}`;
  if (timeframe === "alltime") return `${base}:alltime`;
  if (timeframe === "daily") {
    const p = utcParts(at);
    return `${base}:daily:${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  }
  return `${base}:weekly:${isoWeekKey(at)}`;
}

function metaKey(zsetKey: string) {
  return `meta:${zsetKey}`;
}

function ttlForTimeframe(timeframe: Timeframe): number | null {
  if (timeframe === "daily") return 60 * 60 * 48;
  if (timeframe === "weekly") return 60 * 60 * 24 * 10;
  return null;
}

function normalizeMode(value: unknown): Mode {
  return value === "words" ? "words" : "time";
}

function normalizeTimeframe(value: unknown): Timeframe {
  if (value === "daily" || value === "weekly" || value === "alltime") return value;
  // monthly removed — treat as alltime fallback for old clients
  return "alltime";
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(authHeader: string) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireCallerProfile(authHeader: string | null) {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { error: json(401, { error: "missing_auth" }) };
  }

  const client = userClient(authHeader);
  const result = await client
    .from("profiles")
    .select("user_id, username, avatar_url, show_on_leaderboard")
    .maybeSingle();

  if (result.error) {
    return { error: json(401, { error: "auth_failed", details: result.error.message }) };
  }
  if (!result.data?.user_id) {
    return { error: json(401, { error: "profile_required" }) };
  }
  return { profile: result.data };
}

async function countCompletedTests(userId: string) {
  const sb = serviceClient();
  const result = await sb
    .from("typing_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("failed", false);

  if (result.error) throw result.error;
  return Number(result.count) || 0;
}

async function countCompletedTestsBatch(userIds: string[]) {
  const map = new Map<string, number>();
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const id of unique) map.set(id, 0);
  if (!unique.length) return map;

  await Promise.all(unique.map(async (id) => {
    map.set(id, await countCompletedTests(id));
  }));
  return map;
}

function qualifiesAlltimeScore(completedTests: number, wpm: number) {
  return completedTests >= ALLTIME_MIN_TESTS && wpm >= ALLTIME_MIN_WPM;
}

function buildMetaValue(input: {
  accuracy: number | null;
  raw_wpm: number | null;
  consistency: number | null;
  created_at: string;
}) {
  return JSON.stringify({
    accuracy: input.accuracy,
    raw_wpm: input.raw_wpm,
    consistency: input.consistency,
    created_at: input.created_at,
  });
}

function parseMeta(rawMeta: unknown) {
  const out = {
    accuracy: null as number | null,
    raw_wpm: null as number | null,
    consistency: null as number | null,
    session_created_at: null as string | null,
  };
  if (!rawMeta || typeof rawMeta !== "string") return out;
  try {
    const parsed = JSON.parse(rawMeta);
    if (parsed.accuracy != null) out.accuracy = Number(parsed.accuracy);
    if (parsed.raw_wpm != null) out.raw_wpm = Number(parsed.raw_wpm);
    if (parsed.consistency != null) out.consistency = Number(parsed.consistency);
    if (parsed.created_at) out.session_created_at = String(parsed.created_at);
  } catch {
    /* ignore */
  }
  return out;
}

async function hydrateProfiles(userIds: string[]) {
  if (!userIds.length) {
    return new Map<string, {
      username: string | null;
      avatar_url: string | null;
      show_on_leaderboard: boolean;
      country_code: string | null;
    }>();
  }

  const sb = serviceClient();
  // Profiles only — level/XP comes from a single lean client RPC (cached),
  // so Redis leaderboard edge stays cheap on free-tier limits.
  const result = await sb
    .from("profiles")
    .select("user_id, username, display_name, avatar_url, show_on_leaderboard, country_code")
    .in("user_id", userIds);

  if (result.error) throw result.error;

  const map = new Map<string, {
    username: string | null;
    avatar_url: string | null;
    show_on_leaderboard: boolean;
    country_code: string | null;
  }>();

  for (const row of result.data || []) {
    const rawCode = row.country_code ? String(row.country_code).trim().toUpperCase() : "";
    map.set(row.user_id, {
      username: row.username || row.display_name || "Player",
      avatar_url: row.avatar_url || null,
      show_on_leaderboard: row.show_on_leaderboard !== false,
      country_code: /^[A-Z]{2}$/.test(rawCode) ? rawCode : null,
    });
  }
  return map;
}

async function upsertBoardScore(options: {
  mode: Mode;
  amount: number;
  timeframe: Timeframe;
  userId: string;
  wpm: number;
  metaValue: string;
  at: Date;
}) {
  const zkey = boardKey(options.mode, options.amount, options.timeframe, options.at);
  const mkey = metaKey(zkey);

  const beforeRaw = await redisCommand(["ZSCORE", zkey, options.userId]);
  const before = beforeRaw == null ? null : Number(beforeRaw);

  await redisCommand(["ZADD", zkey, "GT", options.wpm, options.userId]);

  const afterRaw = await redisCommand(["ZSCORE", zkey, options.userId]);
  const after = afterRaw == null ? null : Number(afterRaw);

  // ZADD returns new-member count only (0 on score update). Compare scores instead.
  const scoreApplied =
    after != null &&
    isFinite(after) &&
    Math.abs(after - options.wpm) < 0.02 &&
    (before == null || options.wpm > before + 0.001);

  if (!scoreApplied) return false;

  const followUp: Array<Array<string | number>> = [
    ["HSET", mkey, options.userId, options.metaValue],
  ];
  const ttl = ttlForTimeframe(options.timeframe);
  if (ttl) {
    followUp.push(["EXPIRE", zkey, ttl]);
    followUp.push(["EXPIRE", mkey, ttl]);
  }
  await redisPipeline(followUp);
  return true;
}

type BoardEntryMeta = {
  user_id: string;
  wpm: number;
  accuracy: number | null;
  raw_wpm: number | null;
  consistency: number | null;
  session_created_at: string | null;
};

function pickSessionForBoardScore(
  rows: Array<{
    user_id: string;
    wpm: number | string;
    raw_wpm: number | string | null;
    accuracy: number | string | null;
    consistency: number | string | null;
    created_at: string | null;
  }>,
  userId: string,
  boardWpm: number,
) {
  const userRows = rows.filter((row) => row.user_id === userId);
  if (!userRows.length) return null;

  const exactMatches = userRows
    .filter((row) => Math.abs(Number(row.wpm) - boardWpm) < 0.05)
    .sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return ta - tb;
    });

  if (exactMatches.length) return exactMatches[0];

  return userRows.sort((a, b) => Number(b.wpm) - Number(a.wpm))[0];
}

async function hydrateDisplayFieldsFromPostgres(
  mode: Mode,
  amount: number,
  entries: BoardEntryMeta[],
) {
  if (!entries.length) return;

  const sb = serviceClient();
  const userIds = [...new Set(entries.map((entry) => entry.user_id))];
  const result = await sb
    .from("typing_sessions")
    .select("user_id, wpm, raw_wpm, accuracy, consistency, created_at")
    .eq("mode", mode)
    .eq("amount", amount)
    .eq("failed", false)
    .in("user_id", userIds);

  if (result.error) throw result.error;
  const rows = result.data || [];

  for (const entry of entries) {
    const match = pickSessionForBoardScore(rows, entry.user_id, entry.wpm);
    if (!match) continue;

    entry.accuracy = match.accuracy == null ? null : Number(match.accuracy);
    entry.raw_wpm = match.raw_wpm == null ? null : Number(match.raw_wpm);
    entry.consistency = match.consistency == null ? null : Number(match.consistency);
    entry.session_created_at = match.created_at || entry.session_created_at;
  }
}

async function cacheEntryMeta(
  zkey: string,
  entries: BoardEntryMeta[],
) {
  if (!entries.length) return;
  const mkey = metaKey(zkey);
  const commands: Array<Array<string | number>> = [];

  for (const entry of entries) {
    if (
      entry.accuracy == null &&
      entry.raw_wpm == null &&
      entry.consistency == null &&
      !entry.session_created_at
    ) {
      continue;
    }
    commands.push([
      "HSET",
      mkey,
      entry.user_id,
      buildMetaValue({
        accuracy: entry.accuracy,
        raw_wpm: entry.raw_wpm,
        consistency: entry.consistency,
        created_at: entry.session_created_at || new Date().toISOString(),
      }),
    ]);
  }

  if (!commands.length) return;
  for (let i = 0; i < commands.length; i += 40) {
    await redisPipeline(commands.slice(i, i + 40));
  }
}

async function removeFromBoard(mode: Mode, amount: number, timeframe: Timeframe, userId: string, at = new Date()) {
  const zkey = boardKey(mode, amount, timeframe, at);
  const mkey = metaKey(zkey);
  await redisPipeline([
    ["ZREM", zkey, userId],
    ["HDEL", mkey, userId],
  ]);
}

async function handleTop(body: Record<string, unknown>) {
  const mode = normalizeMode(body.mode);
  const amount = Math.max(1, Math.round(Number(body.amount) || 30));
  const timeframe = normalizeTimeframe(body.timeframe);
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 50));
  const zkey = boardKey(mode, amount, timeframe);
  const mkey = metaKey(zkey);

  // Pull extra rows for all-time so filtering ineligible users still fills the board.
  const fetchCount = timeframe === "alltime" ? Math.min(200, Math.max(limit * 3, limit)) : limit;
  const raw = await redisCommand(["ZREVRANGE", zkey, 0, fetchCount - 1, "WITHSCORES"]);
  const pairs = Array.isArray(raw) ? raw : [];
  const entries: Array<{
    user_id: string;
    wpm: number;
    accuracy: number | null;
    raw_wpm: number | null;
    consistency: number | null;
    session_created_at: string | null;
  }> = [];

  for (let i = 0; i < pairs.length; i += 2) {
    const userId = String(pairs[i]);
    const wpm = Number(pairs[i + 1]);
    entries.push({
      user_id: userId,
      wpm: isFinite(wpm) ? wpm : 0,
      accuracy: null,
      raw_wpm: null,
      consistency: null,
      session_created_at: null,
    });
  }

  if (entries.length) {
    const metaFields = await redisCommand(["HMGET", mkey, ...entries.map((e) => e.user_id)]);
    const metas = Array.isArray(metaFields) ? metaFields : [];
    for (let i = 0; i < entries.length; i++) {
      const parsed = parseMeta(metas[i]);
      entries[i].accuracy = parsed.accuracy;
      entries[i].raw_wpm = parsed.raw_wpm;
      entries[i].consistency = parsed.consistency;
      entries[i].session_created_at = parsed.session_created_at;
    }
  }

  // Postgres is source of truth for display fields tied to the board WPM.
  await hydrateDisplayFieldsFromPostgres(mode, amount, entries);
  await cacheEntryMeta(zkey, entries);

  let eligibleEntries = entries;
  if (timeframe === "alltime" && entries.length) {
    const testCounts = await countCompletedTestsBatch(entries.map((e) => e.user_id));
    const removeCmds: Array<Array<string | number>> = [];
    eligibleEntries = [];
    for (const entry of entries) {
      const tests = testCounts.get(entry.user_id) || 0;
      if (!qualifiesAlltimeScore(tests, entry.wpm)) {
        removeCmds.push(["ZREM", zkey, entry.user_id]);
        removeCmds.push(["HDEL", mkey, entry.user_id]);
        continue;
      }
      eligibleEntries.push(entry);
    }
    if (removeCmds.length) {
      for (let i = 0; i < removeCmds.length; i += 40) {
        await redisPipeline(removeCmds.slice(i, i + 40));
      }
    }
  }

  const profiles = await hydrateProfiles(eligibleEntries.map((e) => e.user_id));
  const ranked = [];
  let rank = 0;
  for (const entry of eligibleEntries) {
    if (rank >= limit) break;
    const profile = profiles.get(entry.user_id);
    if (profile && profile.show_on_leaderboard === false) continue;
    rank += 1;
    ranked.push({
      rank,
      user_id: entry.user_id,
      username: (profile && profile.username) || "Player",
      avatar_url: (profile && profile.avatar_url) || null,
      country_code: (profile && profile.country_code) || null,
      wpm: entry.wpm,
      accuracy: entry.accuracy,
      raw_wpm: entry.raw_wpm,
      consistency: entry.consistency,
      session_created_at: entry.session_created_at,
    });
  }

  return json(200, {
    source: "redis",
    mode,
    amount,
    timeframe,
    limit,
    entries: ranked,
  });
}

async function handleRank(body: Record<string, unknown>, authHeader: string | null) {
  const auth = await requireCallerProfile(authHeader);
  if (auth.error) return auth.error;

  const mode = normalizeMode(body.mode);
  const amount = Math.max(1, Math.round(Number(body.amount) || 30));
  const timeframe = normalizeTimeframe(body.timeframe);
  const userId = auth.profile.user_id;
  const zkey = boardKey(mode, amount, timeframe);

  // All-time: never report a rank for users who do not meet the gates.
  // Also self-heal stale Redis members left over from before the rule change.
  if (timeframe === "alltime") {
    const completedTests = await countCompletedTests(userId);
    const scoreRaw = await redisCommand(["ZSCORE", zkey, userId]);
    const wpmOnBoard = scoreRaw == null ? null : Number(scoreRaw);

    if (
      completedTests < ALLTIME_MIN_TESTS ||
      (wpmOnBoard != null && wpmOnBoard < ALLTIME_MIN_WPM)
    ) {
      if (wpmOnBoard != null) {
        await removeFromBoard(mode, amount, "alltime", userId);
      }
      const total = await redisCommand(["ZCARD", zkey]);
      return json(200, {
        source: "redis",
        rank: null,
        wpm: null,
        accuracy: null,
        raw_wpm: null,
        consistency: null,
        totalPlayers: Number(total) || 0,
        alltime_eligible: false,
        completed_tests: completedTests,
      });
    }
  }

  const pipeline = await redisPipeline([
    ["ZREVRANK", zkey, userId],
    ["ZSCORE", zkey, userId],
    ["ZCARD", zkey],
  ]);

  const rank0 = pipeline[0]?.result;
  const score = pipeline[1]?.result;
  const total = pipeline[2]?.result;

  if (rank0 == null) {
    return json(200, {
      source: "redis",
      rank: null,
      wpm: null,
      accuracy: null,
      raw_wpm: null,
      consistency: null,
      totalPlayers: Number(total) || 0,
    });
  }

  const boardWpm = score == null ? null : Number(score);
  const displayEntry: BoardEntryMeta = {
    user_id: userId,
    wpm: boardWpm || 0,
    accuracy: null,
    raw_wpm: null,
    consistency: null,
    session_created_at: null,
  };

  if (boardWpm != null && isFinite(boardWpm)) {
    await hydrateDisplayFieldsFromPostgres(mode, amount, [displayEntry]);
    await cacheEntryMeta(zkey, [displayEntry]);
  }

  return json(200, {
    source: "redis",
    rank: Number(rank0) + 1,
    wpm: boardWpm,
    accuracy: displayEntry.accuracy,
    raw_wpm: displayEntry.raw_wpm,
    consistency: displayEntry.consistency,
    totalPlayers: Number(total) || 0,
  });
}

async function handleIngest(body: Record<string, unknown>, authHeader: string | null) {
  const auth = await requireCallerProfile(authHeader);
  if (auth.error) return auth.error;

  if (auth.profile.show_on_leaderboard === false) {
    return json(200, { source: "redis", skipped: true, reason: "opted_out" });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!sessionId) {
    return json(400, { error: "session_id_required" });
  }

  const userId = auth.profile.user_id;
  const sb = serviceClient();
  const sessionResult = await sb
    .from("typing_sessions")
    .select("id, user_id, mode, amount, wpm, raw_wpm, accuracy, consistency, created_at, failed")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionResult.error) throw sessionResult.error;
  const session = sessionResult.data;
  if (!session) {
    return json(404, { error: "session_not_found" });
  }
  if (session.user_id !== userId) {
    return json(403, { error: "forbidden_session" });
  }
  if (session.failed) {
    return json(200, { source: "redis", skipped: true, reason: "failed_test" });
  }

  const mode = normalizeMode(session.mode);
  const amount = Math.max(1, Math.round(Number(session.amount) || 1));
  if (!BOARD_COMBOS.some((c) => c.mode === mode && c.amount === amount)) {
    return json(200, { source: "redis", skipped: true, reason: "unsupported_combo" });
  }

  const wpm = Number(session.wpm);
  if (!isFinite(wpm) || wpm <= 0) {
    return json(200, { source: "redis", skipped: true, reason: "invalid_wpm" });
  }
  if (wpm > MAX_INGEST_WPM) {
    return json(200, { source: "redis", skipped: true, reason: "wpm_cap" });
  }

  const createdAt = session.created_at || new Date().toISOString();
  const at = new Date(createdAt);
  if (!isFinite(at.getTime()) || (Date.now() - at.getTime()) > MAX_INGEST_AGE_MS) {
    return json(200, { source: "redis", skipped: true, reason: "session_too_old" });
  }

  const accuracy = session.accuracy == null ? null : Number(session.accuracy);
  const rawWpm = session.raw_wpm == null ? null : Number(session.raw_wpm);
  const consistency = session.consistency == null ? null : Number(session.consistency);
  const metaValue = buildMetaValue({
    accuracy: isFinite(Number(accuracy)) ? Number(accuracy) : null,
    raw_wpm: isFinite(Number(rawWpm)) ? Number(rawWpm) : null,
    consistency: isFinite(Number(consistency)) ? Number(consistency) : null,
    created_at: createdAt,
  });

  // Daily + weekly: no min-test / min-wpm gates.
  const dailyUpdated = await upsertBoardScore({
    mode, amount, timeframe: "daily", userId, wpm, metaValue, at,
  });
  const weeklyUpdated = await upsertBoardScore({
    mode, amount, timeframe: "weekly", userId, wpm, metaValue, at,
  });

  const completedTests = await countCompletedTests(userId);
  const qualifiesAlltime = qualifiesAlltimeScore(completedTests, wpm);

  let alltimeUpdated = false;
  if (qualifiesAlltime) {
    // Only insert/improve all-time when this score meets the gates.
    alltimeUpdated = await upsertBoardScore({
      mode, amount, timeframe: "alltime", userId, wpm, metaValue, at,
    });
  } else if (completedTests < ALLTIME_MIN_TESTS) {
    // Under the test threshold: never stay on all-time (clears pre-gate stale rows).
    await removeFromBoard(mode, amount, "alltime", userId, at);
  }
  // If they already qualify on tests but this attempt is < 30 WPM, leave any better
  // all-time score alone.

  return json(200, {
    source: "redis",
    skipped: false,
    updated: alltimeUpdated,
    daily_updated: dailyUpdated,
    weekly_updated: weeklyUpdated,
    alltime_eligible: qualifiesAlltime,
    completed_tests: completedTests,
    user_id: userId,
    session_id: sessionId,
    mode,
    amount,
    wpm,
  });
}

const BOARD_COMBOS: Array<{ mode: Mode; amount: number }> = [
  { mode: "time", amount: 15 },
  { mode: "time", amount: 30 },
  { mode: "time", amount: 60 },
  { mode: "time", amount: 120 },
  { mode: "words", amount: 10 },
  { mode: "words", amount: 25 },
  { mode: "words", amount: 50 },
  { mode: "words", amount: 100 },
];

const ALL_TIMEFRAMES: Timeframe[] = ["alltime", "daily", "weekly"];

async function removeUserFromBoards(userId: string) {
  const commands: Array<Array<string | number>> = [];
  const now = new Date();

  for (const combo of BOARD_COMBOS) {
    for (const timeframe of ALL_TIMEFRAMES) {
      const zkey = boardKey(combo.mode, combo.amount, timeframe, now);
      const mkey = metaKey(zkey);
      commands.push(["ZREM", zkey, userId]);
      commands.push(["HDEL", mkey, userId]);
    }
  }

  for (let i = 0; i < commands.length; i += 40) {
    await redisPipeline(commands.slice(i, i + 40));
  }
}

async function reseedUserBests(userId: string) {
  const sb = serviceClient();
  const result = await sb
    .from("typing_sessions")
    .select("mode, amount, wpm, raw_wpm, accuracy, consistency, created_at, failed")
    .eq("user_id", userId)
    .eq("failed", false)
    .gt("wpm", 0);

  if (result.error) throw result.error;

  const sessions = result.data || [];
  const completedTests = sessions.length;
  const qualifiesAlltime = completedTests >= ALLTIME_MIN_TESTS;

  const bestByCombo = new Map<string, {
    mode: Mode;
    amount: number;
    wpm: number;
    raw_wpm: number | null;
    accuracy: number | null;
    consistency: number | null;
    created_at: string;
  }>();

  for (const row of sessions) {
    const mode = normalizeMode(row.mode);
    const amount = Number(row.amount);
    if (!BOARD_COMBOS.some((c) => c.mode === mode && c.amount === amount)) continue;
    const key = `${mode}:${amount}`;
    const wpm = Number(row.wpm);
    if (!isFinite(wpm) || wpm <= 0) continue;
    const current = bestByCombo.get(key);
    if (!current || wpm > current.wpm) {
      bestByCombo.set(key, {
        mode,
        amount,
        wpm,
        raw_wpm: row.raw_wpm == null ? null : Number(row.raw_wpm),
        accuracy: row.accuracy == null ? null : Number(row.accuracy),
        consistency: row.consistency == null ? null : Number(row.consistency),
        created_at: row.created_at || new Date().toISOString(),
      });
    }
  }

  for (const best of bestByCombo.values()) {
    const at = new Date(best.created_at);
    const now = new Date();
    const metaValue = buildMetaValue({
      accuracy: best.accuracy,
      raw_wpm: best.raw_wpm,
      consistency: best.consistency,
      created_at: best.created_at,
    });

    // Current period boards use "now" so opt-in puts the user on today's/this week's lists.
    await upsertBoardScore({
      mode: best.mode,
      amount: best.amount,
      timeframe: "daily",
      userId,
      wpm: best.wpm,
      metaValue,
      at: now,
    });
    await upsertBoardScore({
      mode: best.mode,
      amount: best.amount,
      timeframe: "weekly",
      userId,
      wpm: best.wpm,
      metaValue,
      at: now,
    });

    if (qualifiesAlltime && best.wpm >= ALLTIME_MIN_WPM) {
      await upsertBoardScore({
        mode: best.mode,
        amount: best.amount,
        timeframe: "alltime",
        userId,
        wpm: best.wpm,
        metaValue,
        at,
      });
    } else {
      await removeFromBoard(best.mode, best.amount, "alltime", userId, at);
    }
  }

  return bestByCombo.size;
}

async function handleSetVisibility(body: Record<string, unknown>, authHeader: string | null) {
  const auth = await requireCallerProfile(authHeader);
  if (auth.error) return auth.error;

  const show = body.show_on_leaderboard !== false && body.show_on_leaderboard !== "false";
  const userId = auth.profile.user_id;

  if (!redisConfigured()) {
    return json(200, {
      source: "postgres_only",
      show_on_leaderboard: show,
      redis: "skipped",
      reason: "REDIS_NOT_CONFIGURED",
    });
  }

  if (!show) {
    await removeUserFromBoards(userId);
    return json(200, {
      source: "redis",
      show_on_leaderboard: false,
      redis: "removed",
    });
  }

  const reseeded = await reseedUserBests(userId);
  return json(200, {
    source: "redis",
    show_on_leaderboard: true,
    redis: "reseeded",
    boards: reseeded,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const action = String(body.action || "");
  const authHeader = req.headers.get("Authorization");

  if (action !== "set_visibility" && !redisConfigured()) {
    return json(503, { error: "REDIS_NOT_CONFIGURED" });
  }

  try {
    if (action === "top") return await handleTop(body);
    if (action === "rank") return await handleRank(body, authHeader);
    if (action === "ingest") return await handleIngest(body, authHeader);
    if (action === "set_visibility") return await handleSetVisibility(body, authHeader);
    return json(400, { error: "unknown_action" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "REDIS_NOT_CONFIGURED") {
      return json(503, { error: "REDIS_NOT_CONFIGURED" });
    }
    console.error("[leaderboards]", message);
    return json(500, { error: "leaderboard_failed", details: message });
  }
});
