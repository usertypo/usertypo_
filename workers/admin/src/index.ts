/**
 * usertypo_ Admin Worker — allowlisted public_ids only.
 * Auth: Clerk JWT + profiles.public_id ∈ ADMIN_PUBLIC_IDS.
 */
import {
  type Env,
  type AdminProfile,
  adminPublicIds,
  bearerToken,
  clerkApi,
  fetchProfileByPublicId,
  fetchProfileByUserId,
  requireAdmin,
  requireSignedIn,
  supabaseRest,
  supabaseRpc,
  writeAudit,
} from './auth';

const DEFAULT_ORIGINS = [
  'https://usertypo.com',
  'https://www.usertypo.com',
  'https://usertypo.pages.dev',
  'https://dev.usertypo.com',
  'https://dev.usertypo.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const HEARTBEAT_IDLE_MS = 3 * 60 * 1000;

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
  headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
}

function json(env: Env, status: number, body: unknown, request?: Request): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  applyCors(env, request, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function errStatus(message: string): number {
  if (message === 'missing_token' || message === 'invalid_token') return 401;
  if (message === 'forbidden') return 403;
  if (message === 'not_found') return 404;
  if (message === 'bad_request') return 400;
  if (message === 'clerk_secret_missing' || message === 'supabase_not_configured') return 503;
  return 500;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function avgVisitSeconds(env: Env, userId?: string | null): Promise<number> {
  try {
    const val = await supabaseRpc<number | string | null>(env, 'admin_avg_visit_seconds', {
      p_user_id: userId || null,
    });
    const n = Number(val);
    return Number.isFinite(n) ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

async function searchUsers(env: Env, q: string, limit: number): Promise<AdminProfile[]> {
  const query = q.trim();
  if (!query) return [];
  const upper = query.toUpperCase();

  // Prefer exact public_id match first.
  if (/^[A-Z0-9]{8}$/i.test(query)) {
    const exact = await fetchProfileByPublicId(env, upper);
    if (exact) return [exact];
  }

  const safe = query.replace(/[%_,.()]/g, '');
  if (!safe) return [];
  const encoded = encodeURIComponent(`%${safe}%`);
  const rows = await supabaseRest<Record<string, unknown>[]>(
    env,
    `profiles?or=(username.ilike.${encoded},display_name.ilike.${encoded})`
      + `&select=user_id,public_id,username,display_name,avatar_url,country_code,last_seen_at,is_banned,banned_at,banned_reason,show_on_leaderboard`
      + `&order=username.asc&limit=${limit}`,
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
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
  }));
}

async function recentSessions(env: Env, userId: string, limit: number) {
  const rows = await supabaseRest<Record<string, unknown>[]>(
    env,
    `typing_sessions?user_id=eq.${encodeURIComponent(userId)}`
      + `&select=id,wpm,accuracy,mode,amount,language,created_at,duration_seconds`
      + `&order=created_at.desc&limit=${limit}`,
  );
  return Array.isArray(rows) ? rows : [];
}

async function progressionFor(env: Env, userId: string) {
  const rows = await supabaseRest<Record<string, unknown>[]>(
    env,
    `user_progression?user_id=eq.${encodeURIComponent(userId)}`
      + `&select=level,total_xp,xp_into_level&limit=1`,
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function handlePresenceHeartbeat(env: Env, request: Request): Promise<Response> {
  const session = await requireSignedIn(env, request);
  const userId = session.userId;
  const now = new Date();
  const nowIso = now.toISOString();

  const open = await supabaseRest<Record<string, unknown>[]>(
    env,
    `visit_sessions?user_id=eq.${encodeURIComponent(userId)}&ended_at=is.null`
      + `&select=id,started_at,last_heartbeat_at,duration_seconds&order=last_heartbeat_at.desc&limit=1`,
  );

  let visitId: string | null = null;
  if (Array.isArray(open) && open[0]) {
    const lastBeat = new Date(String(open[0].last_heartbeat_at || 0)).getTime();
    if (Number.isFinite(lastBeat) && now.getTime() - lastBeat < HEARTBEAT_IDLE_MS) {
      visitId = String(open[0].id);
      const started = new Date(String(open[0].started_at || nowIso)).getTime();
      const duration = Math.max(0, Math.floor((now.getTime() - started) / 1000));
      await supabaseRest(env, `visit_sessions?id=eq.${encodeURIComponent(visitId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          last_heartbeat_at: nowIso,
          duration_seconds: duration,
        }),
      });
      return json(env, 200, { ok: true, visit_id: visitId, continued: true }, request);
    }
    // Stale open session — close it.
    const staleId = String(open[0].id);
    const started = new Date(String(open[0].started_at || nowIso)).getTime();
    const last = Number.isFinite(lastBeat) ? lastBeat : now.getTime();
    const duration = Math.max(0, Math.floor((last - started) / 1000));
    await supabaseRest(env, `visit_sessions?id=eq.${encodeURIComponent(staleId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ended_at: new Date(last).toISOString(),
        duration_seconds: duration,
        last_heartbeat_at: new Date(last).toISOString(),
      }),
    });
  }

  const created = await supabaseRest<Record<string, unknown>[]>(env, 'visit_sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      started_at: nowIso,
      last_heartbeat_at: nowIso,
      duration_seconds: 0,
    }),
  });
  visitId = Array.isArray(created) && created[0] ? String(created[0].id) : null;
  return json(env, 200, { ok: true, visit_id: visitId, continued: false }, request);
}

async function handlePresenceEnd(env: Env, request: Request): Promise<Response> {
  const session = await requireSignedIn(env, request);
  const userId = session.userId;
  const nowIso = new Date().toISOString();
  const open = await supabaseRest<Record<string, unknown>[]>(
    env,
    `visit_sessions?user_id=eq.${encodeURIComponent(userId)}&ended_at=is.null`
      + `&select=id,started_at,last_heartbeat_at&order=last_heartbeat_at.desc&limit=1`,
  );
  if (!Array.isArray(open) || !open[0]) {
    return json(env, 200, { ok: true, closed: false }, request);
  }
  const row = open[0];
  const started = new Date(String(row.started_at || nowIso)).getTime();
  const duration = Math.max(0, Math.floor((Date.now() - started) / 1000));
  await supabaseRest(env, `visit_sessions?id=eq.${encodeURIComponent(String(row.id))}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      ended_at: nowIso,
      last_heartbeat_at: nowIso,
      duration_seconds: duration,
    }),
  });
  return json(env, 200, { ok: true, closed: true, duration_seconds: duration }, request);
}

async function createActorToken(env: Env, targetUserId: string, actorId: string) {
  const res = await clerkApi(env, '/actor_tokens', {
    method: 'POST',
    body: JSON.stringify({
      user_id: targetUserId,
      actor: { sub: actorId },
      expires_in_seconds: 3600,
      session_max_duration_in_seconds: 3600,
    }),
  });
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) {
    console.warn('[admin] actor_token failed', res.status, data);
    throw new Error('actor_token_failed');
  }
  return data;
}

async function createSignInToken(env: Env, userId: string) {
  const res = await clerkApi(env, '/sign_in_tokens', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      expires_in_seconds: 300,
    }),
  });
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) {
    console.warn('[admin] sign_in_token failed', res.status, data);
    throw new Error('sign_in_token_failed');
  }
  return data;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {};
      applyCors(env, request, headers);
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/health' && request.method === 'GET') {
        return json(env, 200, {
          ok: true,
          service: 'usertypo-admin',
          environment: env.ENVIRONMENT || 'unknown',
          admins: Array.from(adminPublicIds(env)),
        }, request);
      }

      // ---- Presence (any signed-in user) ----
      if (path === '/presence/heartbeat' && request.method === 'POST') {
        return await handlePresenceHeartbeat(env, request);
      }
      if (path === '/presence/end' && request.method === 'POST') {
        return await handlePresenceEnd(env, request);
      }

      // ---- Public report create (optional auth) ----
      if (path === '/reports' && request.method === 'POST') {
        const body = await readJson(request);
        const reason = String(body.reason || body.problem || '').trim();
        const details = String(body.details || body.description || '').trim();
        if (!reason || !details) return json(env, 400, { error: 'bad_request' }, request);

        let reporterUserId: string | null = null;
        try {
          if (bearerToken(request)) {
            const s = await requireSignedIn(env, request);
            reporterUserId = s.userId;
          }
        } catch { /* optional */ }

        let reportedUserId: string | null = null;
        const reportedPublicId = String(body.reported_public_id || '').trim().toUpperCase() || null;
        if (reportedPublicId) {
          const p = await fetchProfileByPublicId(env, reportedPublicId);
          if (p) reportedUserId = p.user_id;
        }

        const created = await supabaseRest<Record<string, unknown>[]>(env, 'user_reports', {
          method: 'POST',
          body: JSON.stringify({
            reporter_user_id: reporterUserId,
            reporter_name: String(body.name || '').trim() || null,
            reporter_email: String(body.email || '').trim() || null,
            reported_user_id: reportedUserId,
            reported_public_id: reportedPublicId,
            reason,
            details,
            status: 'open',
          }),
        });
        return json(env, 201, { ok: true, report: Array.isArray(created) ? created[0] : created }, request);
      }

      // ---- Admin-only below ----
      const { session, admin, effectiveAdminId } = await requireAdmin(env, request);

      if (path === '/me' && request.method === 'GET') {
        return json(env, 200, {
          ok: true,
          admin,
          session_user_id: session.userId,
          actor_id: session.actorId,
          impersonating: !!session.actorId,
        }, request);
      }

      if (path === '/analytics' && request.method === 'GET') {
        const profilesCount = await supabaseRest<Record<string, unknown>[]>(
          env,
          'profiles?select=user_id&limit=1',
          { headers: { Prefer: 'count=exact', Range: '0-0' } },
        ).catch(() => []);
        // Prefer Content-Range via a dedicated HEAD-like fetch
        let totalUsers = 0;
        try {
          const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
          const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
          const res = await fetch(`${base}/rest/v1/profiles?select=user_id`, {
            method: 'HEAD',
            headers: {
              apikey: String(env.SUPABASE_ANON_KEY || key),
              Authorization: `Bearer ${key}`,
              Prefer: 'count=exact',
            },
          });
          const cr = res.headers.get('content-range') || '';
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) totalUsers = Number(m[1]) || 0;
        } catch { /* ignore */ }
        void profilesCount;

        let openReports = 0;
        try {
          const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
          const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
          const res = await fetch(`${base}/rest/v1/user_reports?status=eq.open&select=id`, {
            method: 'HEAD',
            headers: {
              apikey: String(env.SUPABASE_ANON_KEY || key),
              Authorization: `Bearer ${key}`,
              Prefer: 'count=exact',
            },
          });
          const cr = res.headers.get('content-range') || '';
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) openReports = Number(m[1]) || 0;
        } catch { /* ignore */ }

        let bannedUsers = 0;
        try {
          const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
          const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
          const res = await fetch(`${base}/rest/v1/profiles?is_banned=eq.true&select=user_id`, {
            method: 'HEAD',
            headers: {
              apikey: String(env.SUPABASE_ANON_KEY || key),
              Authorization: `Bearer ${key}`,
              Prefer: 'count=exact',
            },
          });
          const cr = res.headers.get('content-range') || '';
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) bannedUsers = Number(m[1]) || 0;
        } catch { /* ignore */ }

        const avgVisit = await avgVisitSeconds(env, null);
        return json(env, 200, {
          ok: true,
          total_users: totalUsers,
          open_reports: openReports,
          banned_users: bannedUsers,
          avg_visit_seconds: avgVisit,
        }, request);
      }

      if (path === '/users' && request.method === 'GET') {
        const q = String(url.searchParams.get('q') || '');
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20) || 20));
        const users = await searchUsers(env, q, limit);
        return json(env, 200, { ok: true, users }, request);
      }

      const userMatch = path.match(/^\/users\/([A-Za-z0-9]{8})$/);
      if (userMatch && request.method === 'GET') {
        const profile = await fetchProfileByPublicId(env, userMatch[1]);
        if (!profile) return json(env, 404, { error: 'not_found' }, request);
        const [sessions, progression, avgVisit] = await Promise.all([
          recentSessions(env, profile.user_id, 25).catch((err) => {
            console.warn('[admin] recentSessions failed', err);
            return [] as Record<string, unknown>[];
          }),
          progressionFor(env, profile.user_id).catch((err) => {
            console.warn('[admin] progressionFor failed', err);
            return null;
          }),
          avgVisitSeconds(env, profile.user_id).catch(() => 0),
        ]);
        return json(env, 200, {
          ok: true,
          user: profile,
          recent_sessions: sessions,
          progression,
          avg_visit_seconds: avgVisit,
        }, request);
      }

      const banMatch = path.match(/^\/users\/([A-Za-z0-9]{8})\/(ban|unban)$/);
      if (banMatch && request.method === 'POST') {
        const profile = await fetchProfileByPublicId(env, banMatch[1]);
        if (!profile) return json(env, 404, { error: 'not_found' }, request);
        if (adminPublicIds(env).has(profile.public_id)) {
          return json(env, 400, { error: 'cannot_ban_admin' }, request);
        }
        const body = await readJson(request);
        const isBan = banMatch[2] === 'ban';
        const patch = isBan
          ? {
              is_banned: true,
              banned_at: new Date().toISOString(),
              banned_reason: String(body.reason || '').trim() || 'Banned by admin',
              banned_by: effectiveAdminId,
            }
          : {
              is_banned: false,
              banned_at: null,
              banned_reason: null,
              banned_by: null,
            };
        await supabaseRest(env, `profiles?user_id=eq.${encodeURIComponent(profile.user_id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(patch),
        });
        await writeAudit(env, effectiveAdminId, isBan ? 'ban' : 'unban', profile.user_id, {
          public_id: profile.public_id,
          reason: patch.banned_reason || null,
        });
        const updated = await fetchProfileByUserId(env, profile.user_id);
        return json(env, 200, { ok: true, user: updated }, request);
      }

      const purgeMatch = path.match(/^\/users\/([A-Za-z0-9]{8})\/scores$/);
      if (purgeMatch && request.method === 'DELETE') {
        const profile = await fetchProfileByPublicId(env, purgeMatch[1]);
        if (!profile) return json(env, 404, { error: 'not_found' }, request);
        await supabaseRest(
          env,
          `typing_sessions?user_id=eq.${encodeURIComponent(profile.user_id)}`,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        );
        await writeAudit(env, effectiveAdminId, 'purge_scores', profile.user_id, {
          public_id: profile.public_id,
        });
        return json(env, 200, { ok: true }, request);
      }

      const impersonateMatch = path.match(/^\/users\/([A-Za-z0-9]{8})\/impersonate$/);
      if (impersonateMatch && request.method === 'POST') {
        // Must be a real admin session (not already impersonating).
        if (session.actorId) {
          return json(env, 400, { error: 'already_impersonating' }, request);
        }
        const profile = await fetchProfileByPublicId(env, impersonateMatch[1]);
        if (!profile) return json(env, 404, { error: 'not_found' }, request);
        if (profile.user_id === session.userId) {
          return json(env, 400, { error: 'cannot_impersonate_self' }, request);
        }
        const tokenData = await createActorToken(env, profile.user_id, session.userId);
        await writeAudit(env, effectiveAdminId, 'impersonate_start', profile.user_id, {
          public_id: profile.public_id,
        });
        return json(env, 200, {
          ok: true,
          token: tokenData?.token || null,
          url: tokenData?.url || null,
          target: profile,
          admin_public_id: admin.public_id,
        }, request);
      }

      if (path === '/impersonate/end' && request.method === 'POST') {
        if (!session.actorId) {
          return json(env, 400, { error: 'not_impersonating' }, request);
        }
        const actorProfile = await fetchProfileByUserId(env, session.actorId);
        if (!actorProfile || !adminPublicIds(env).has(actorProfile.public_id)) {
          return json(env, 403, { error: 'forbidden' }, request);
        }
        const tokenData = await createSignInToken(env, session.actorId);
        await writeAudit(env, session.actorId, 'impersonate_end', session.userId, {});
        return json(env, 200, {
          ok: true,
          token: tokenData?.token || null,
          url: tokenData?.url || null,
          admin: actorProfile,
        }, request);
      }

      if (path === '/reports' && request.method === 'GET') {
        const status = String(url.searchParams.get('status') || 'open');
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50) || 50));
        let filter = `select=*&order=created_at.desc&limit=${limit}`;
        if (status && status !== 'all') {
          filter = `status=eq.${encodeURIComponent(status)}&` + filter;
        }
        const rows = await supabaseRest<Record<string, unknown>[]>(env, `user_reports?${filter}`);
        return json(env, 200, { ok: true, reports: Array.isArray(rows) ? rows : [] }, request);
      }

      const reportMatch = path.match(/^\/reports\/([0-9a-fA-F-]{36})$/);
      if (reportMatch && request.method === 'PATCH') {
        const body = await readJson(request);
        const status = String(body.status || '').trim();
        if (!['open', 'reviewed', 'resolved'].includes(status)) {
          return json(env, 400, { error: 'bad_request' }, request);
        }
        const patch: Record<string, unknown> = {
          status,
          admin_notes: body.notes != null ? String(body.notes) : undefined,
        };
        if (status === 'resolved' || status === 'reviewed') {
          patch.resolved_by = effectiveAdminId;
          patch.resolved_at = new Date().toISOString();
        }
        // Remove undefined keys
        Object.keys(patch).forEach((k) => {
          if (patch[k] === undefined) delete patch[k];
        });
        const updated = await supabaseRest<Record<string, unknown>[]>(
          env,
          `user_reports?id=eq.${encodeURIComponent(reportMatch[1])}`,
          { method: 'PATCH', body: JSON.stringify(patch) },
        );
        await writeAudit(env, effectiveAdminId, 'report_' + status, null, {
          report_id: reportMatch[1],
        });
        return json(env, 200, { ok: true, report: Array.isArray(updated) ? updated[0] : updated }, request);
      }

      // Support: password reset email via Clerk
      const resetMatch = path.match(/^\/users\/([A-Za-z0-9]{8})\/password-reset$/);
      if (resetMatch && request.method === 'POST') {
        const profile = await fetchProfileByPublicId(env, resetMatch[1]);
        if (!profile) return json(env, 404, { error: 'not_found' }, request);
        // Fetch primary email from Clerk
        const userRes = await clerkApi(env, `/users/${encodeURIComponent(profile.user_id)}`);
        const userData = await userRes.json().catch(() => null) as Record<string, unknown> | null;
        if (!userRes.ok || !userData) {
          return json(env, 502, { error: 'clerk_user_lookup_failed' }, request);
        }
        const emails = Array.isArray(userData.email_addresses) ? userData.email_addresses as Record<string, unknown>[] : [];
        const primaryId = userData.primary_email_address_id;
        const primary = emails.find((e) => e.id === primaryId) || emails[0];
        const email = primary && primary.email_address ? String(primary.email_address) : '';
        if (!email) return json(env, 400, { error: 'no_email' }, request);

        const resetRes = await clerkApi(env, '/email_addresses/prepare_verification', {
          method: 'POST',
          body: JSON.stringify({}),
        }).catch(() => null);
        void resetRes;

        // Use Clerk create password reset / invitation pattern via backend sign-in token link instead:
        // Create a sign-in token so support can share a one-time login, plus audit.
        const tokenData = await createSignInToken(env, profile.user_id);
        await writeAudit(env, effectiveAdminId, 'password_reset_token', profile.user_id, {
          public_id: profile.public_id,
          email,
        });
        return json(env, 200, {
          ok: true,
          email,
          token: tokenData?.token || null,
          url: tokenData?.url || null,
          note: 'One-time sign-in token created for support. Share securely with the user.',
        }, request);
      }

      const clearUsernameMatch = path.match(/^\/users\/([A-Za-z0-9]{8})\/clear-username$/);
      if (clearUsernameMatch && request.method === 'POST') {
        const profile = await fetchProfileByPublicId(env, clearUsernameMatch[1]);
        if (!profile) return json(env, 404, { error: 'not_found' }, request);
        if (adminPublicIds(env).has(profile.public_id)) {
          return json(env, 400, { error: 'cannot_modify_admin' }, request);
        }
        await supabaseRest(env, `profiles?user_id=eq.${encodeURIComponent(profile.user_id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            username: null,
            display_name: profile.public_id,
          }),
        });
        await writeAudit(env, effectiveAdminId, 'clear_username', profile.user_id, {
          public_id: profile.public_id,
        });
        const updated = await fetchProfileByUserId(env, profile.user_id);
        return json(env, 200, { ok: true, user: updated }, request);
      }

      return json(env, 404, { error: 'not_found' }, request);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'server_error';
      const status = errStatus(message);
      if (status >= 500) console.warn('[admin] error', message, err);
      return json(env, status, { error: message }, request);
    }
  },
};
