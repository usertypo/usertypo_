/**
 * usertypo_ Notifications Worker — friend inbox on D1 (staging first).
 * Auth: Clerk JWT. Friend emit verified against Supabase friend_requests.
 */
import {
  type Env,
  bearerToken,
  fetchFriendRequest,
  friendshipExists,
  profileDisplayLabel,
  requireUserId,
} from './auth';

const RETENTION_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ORIGINS = [
  'https://usertypo.com',
  'https://www.usertypo.com',
  'https://usertypo.pages.dev',
  'https://dev.usertypo.com',
  'https://dev.usertypo.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: string;
  read_at: string | null;
  created_at: string;
};

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
  headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
}

function json(env: Env, status: number, body: unknown, request?: Request): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  applyCors(env, request, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function uuid(): string {
  return crypto.randomUUID();
}

function parseData(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toClientRow(row: NotificationRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: parseData(row.data),
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

function cutoffIso(): string {
  return new Date(Date.now() - RETENTION_MS).toISOString();
}

async function insertNotification(
  env: Env,
  input: {
    userId: string;
    type: 'friend_request' | 'friend_accepted';
    title: string;
    body: string;
    data: Record<string, unknown>;
  },
): Promise<NotificationRow> {
  const id = uuid();
  const createdAt = new Date().toISOString();
  const dataJson = JSON.stringify(input.data || {});
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, data, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(id, input.userId, input.type, input.title, input.body, dataJson, createdAt)
    .run();

  return {
    id,
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: dataJson,
    read_at: null,
    created_at: createdAt,
  };
}

async function listNotifications(env: Env, userId: string, limit: number) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, type, title, body, data, read_at, created_at
     FROM notifications
     WHERE user_id = ?
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, cutoffIso(), limit)
    .all<NotificationRow>();
  return (rows.results || []).map(toClientRow);
}

async function markRead(env: Env, userId: string, ids: string[] | null) {
  const now = new Date().toISOString();
  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE user_id = ?
         AND read_at IS NULL
         AND id IN (${placeholders})`,
    )
      .bind(now, userId, ...ids)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE notifications
       SET read_at = ?
       WHERE user_id = ?
         AND read_at IS NULL`,
    )
      .bind(now, userId)
      .run();
  }
  return { ok: true, read_at: now };
}

async function deleteOne(env: Env, userId: string, id: string) {
  const result = await env.DB.prepare(
    `DELETE FROM notifications WHERE user_id = ? AND id = ?`,
  )
    .bind(userId, id)
    .run();
  return { ok: true, deleted: result.meta.changes || 0 };
}

async function purgeOld(env: Env, userId: string) {
  const result = await env.DB.prepare(
    `DELETE FROM notifications WHERE user_id = ? AND created_at < ?`,
  )
    .bind(userId, cutoffIso())
    .run();
  return { ok: true, deleted: result.meta.changes || 0 };
}

async function emitFriendNotification(
  env: Env,
  actorId: string,
  userToken: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; notification: ReturnType<typeof toClientRow>; kind: string }> {
  const requestId = String(body.request_id || '').trim();
  const typeHint = String(body.type || '').trim();
  if (!requestId) throw new Error('missing_request_id');

  const fr = await fetchFriendRequest(env, requestId, userToken);
  if (!fr) throw new Error('request_not_found');

  // Auto-accept via send_friend_request returns an already-accepted reverse request
  // where the caller is the accepter (to_user_id). Treat that as friend_accepted.
  if (
    typeHint === 'friend_request'
    && fr.status === 'accepted'
    && fr.to_user_id === actorId
  ) {
    const label = await profileDisplayLabel(env, actorId, userToken);
    const row = await insertNotification(env, {
      userId: fr.from_user_id,
      type: 'friend_accepted',
      title: `${label} accepted your friend request`,
      body: 'You are now friends.',
      data: {
        request_id: fr.id,
        friend_user_id: actorId,
        friend_username: label,
      },
    });
    return { ok: true, notification: toClientRow(row), kind: 'friend_accepted' };
  }

  if (typeHint === 'friend_request' || (!typeHint && fr.status === 'pending' && fr.from_user_id === actorId)) {
    if (fr.from_user_id !== actorId) throw new Error('forbidden');
    if (fr.status !== 'pending') throw new Error('request_not_pending');
    const label = await profileDisplayLabel(env, actorId, userToken);
    const row = await insertNotification(env, {
      userId: fr.to_user_id,
      type: 'friend_request',
      title: `${label} sent you a friend request`,
      body: 'Accept or decline below.',
      data: {
        request_id: fr.id,
        from_user_id: actorId,
        from_username: label,
      },
    });
    return { ok: true, notification: toClientRow(row), kind: 'friend_request' };
  }

  if (typeHint === 'friend_accepted' || (!typeHint && fr.status === 'accepted' && fr.to_user_id === actorId)) {
    if (fr.to_user_id !== actorId) throw new Error('forbidden');
    if (fr.status !== 'accepted') {
      const friends = await friendshipExists(env, actorId, fr.from_user_id, userToken);
      if (!friends) throw new Error('not_friends');
    }
    const label = await profileDisplayLabel(env, actorId, userToken);
    const row = await insertNotification(env, {
      userId: fr.from_user_id,
      type: 'friend_accepted',
      title: `${label} accepted your friend request`,
      body: 'You are now friends.',
      data: {
        request_id: fr.id,
        friend_user_id: actorId,
        friend_username: label,
      },
    });
    return { ok: true, notification: toClientRow(row), kind: 'friend_accepted' };
  }

  // Explicit to_user_id path from plan (accepter notifies original requester)
  const toUserId = String(body.to_user_id || '').trim();
  if (typeHint === 'friend_accepted' && toUserId) {
    const friends = await friendshipExists(env, actorId, toUserId, userToken);
    if (!friends) throw new Error('not_friends');
    const label = await profileDisplayLabel(env, actorId, userToken);
    const row = await insertNotification(env, {
      userId: toUserId,
      type: 'friend_accepted',
      title: `${label} accepted your friend request`,
      body: 'You are now friends.',
      data: {
        request_id: requestId || null,
        friend_user_id: actorId,
        friend_username: label,
      },
    });
    return { ok: true, notification: toClientRow(row), kind: 'friend_accepted' };
  }

  throw new Error('invalid_emit');
}

function statusForAuthError(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (msg === 'missing_token' || msg === 'invalid_token') return 401;
  if (msg === 'forbidden' || msg === 'request_not_pending' || msg === 'not_friends') return 403;
  if (msg === 'request_not_found' || msg === 'missing_request_id') return 400;
  if (msg === 'supabase_not_configured') return 500;
  return 400;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {};
      applyCors(env, request, headers);
      return new Response('ok', { headers });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json(env, 200, { ok: true, service: 'usertypo-notifications' }, request);
    }

    let userId: string;
    try {
      userId = await requireUserId(env, request);
    } catch (err) {
      return json(env, statusForAuthError(err), {
        ok: false,
        error: err instanceof Error ? err.message : 'unauthorized',
      }, request);
    }

    try {
      if (url.pathname === '/notifications' && request.method === 'GET') {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
        const rows = await listNotifications(env, userId, limit);
        return json(env, 200, rows, request);
      }

      if (url.pathname === '/notifications/read' && request.method === 'POST') {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const idsRaw = Array.isArray(body.ids) ? body.ids : null;
        const ids = idsRaw
          ? idsRaw.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 100)
          : null;
        const result = await markRead(env, userId, ids);
        return json(env, 200, result, request);
      }

      if (url.pathname === '/notifications/purge' && request.method === 'POST') {
        const result = await purgeOld(env, userId);
        return json(env, 200, result, request);
      }

      if (url.pathname === '/notifications/emit' && request.method === 'POST') {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        if (!body) return json(env, 400, { ok: false, error: 'invalid_json' }, request);
        const token = bearerToken(request);
        if (!token) return json(env, 401, { ok: false, error: 'missing_token' }, request);
        const result = await emitFriendNotification(env, userId, token, body);
        return json(env, 200, result, request);
      }

      const deleteMatch = url.pathname.match(/^\/notifications\/([^/]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(deleteMatch[1]);
        const result = await deleteOne(env, userId, id);
        return json(env, 200, result, request);
      }

      return json(env, 404, { error: 'not_found' }, request);
    } catch (err) {
      console.warn('[notifications] handler error', err);
      return json(env, statusForAuthError(err), {
        ok: false,
        error: err instanceof Error ? err.message : 'error',
      }, request);
    }
  },
};
