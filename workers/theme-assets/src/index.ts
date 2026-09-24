/**
 * usertypo_ Theme Assets Worker — custom theme background images on R2.
 * Auth: Clerk JWT for upload/delete. Public GET for serving images.
 */
import { type Env, requireUserId } from './auth';

const MAX_BYTES = 2 * 1024 * 1024; // 2MB compressed

const DEFAULT_ORIGINS = [
  'https://usertypo.com',
  'https://www.usertypo.com',
  'https://usertypo.pages.dev',
  'https://dev.usertypo.com',
  'https://dev.usertypo.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

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
  headers['Access-Control-Allow-Methods'] = 'GET, PUT, DELETE, OPTIONS';
}

function json(env: Env, status: number, body: unknown, request?: Request): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  applyCors(env, request, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function safeUserSegment(userId: string): string {
  return String(userId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128) || 'user';
}

function extForType(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return 'jpg';
}

function publicObjectUrl(request: Request, key: string): string {
  const url = new URL(request.url);
  return `${url.origin}/bg/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function parseObjectKey(pathname: string): string | null {
  // /bg/{userId}/{file}
  const parts = pathname.replace(/^\/+/, '').split('/');
  if (parts[0] !== 'bg' || parts.length < 3) return null;
  const user = decodeURIComponent(parts[1] || '');
  const file = decodeURIComponent(parts.slice(2).join('/'));
  if (!user || !file || file.includes('..')) return null;
  return `${user}/${file}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {};
      applyCors(env, request, headers);
      return new Response(null, { status: 204, headers });
    }

    try {
      if (request.method === 'GET' && path === '/health') {
        return json(env, 200, { ok: true, service: 'theme-assets' }, request);
      }

      // Public read
      if (request.method === 'GET' && path.startsWith('/bg/')) {
        const key = parseObjectKey(path);
        if (!key) return json(env, 404, { error: 'not_found' }, request);
        const obj = await env.THEME_BGS.get(key);
        if (!obj) return json(env, 404, { error: 'not_found' }, request);
        const headers: Record<string, string> = {
          'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        };
        applyCors(env, request, headers);
        return new Response(obj.body, { status: 200, headers });
      }

      // Authenticated upload
      if (request.method === 'PUT' && path === '/upload') {
        const userId = await requireUserId(env, request);
        const type = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
        if (!ALLOWED_TYPES.has(type)) {
          return json(env, 400, { error: 'unsupported_type' }, request);
        }
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) return json(env, 400, { error: 'empty_body' }, request);
        if (buf.byteLength > MAX_BYTES) return json(env, 413, { error: 'too_large' }, request);

        const key = `${safeUserSegment(userId)}/${crypto.randomUUID()}.${extForType(type)}`;
        await env.THEME_BGS.put(key, buf, {
          httpMetadata: { contentType: type === 'image/jpg' ? 'image/jpeg' : type },
          customMetadata: { userId },
        });

        return json(env, 200, {
          ok: true,
          key,
          url: publicObjectUrl(request, key),
          bytes: buf.byteLength,
        }, request);
      }

      // Authenticated delete (own objects only)
      if (request.method === 'DELETE' && path.startsWith('/bg/')) {
        const userId = await requireUserId(env, request);
        const key = parseObjectKey(path);
        if (!key) return json(env, 404, { error: 'not_found' }, request);
        const prefix = `${safeUserSegment(userId)}/`;
        if (!key.startsWith(prefix)) {
          return json(env, 403, { error: 'forbidden' }, request);
        }
        await env.THEME_BGS.delete(key);
        return json(env, 200, { ok: true, key }, request);
      }

      return json(env, 404, { error: 'not_found' }, request);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'server_error';
      const status =
        message === 'missing_token' || message === 'invalid_token' ? 401
          : message === 'clerk_not_configured' ? 503
            : 500;
      console.warn('[theme-assets]', message);
      return json(env, status, { error: message }, request);
    }
  },
};
