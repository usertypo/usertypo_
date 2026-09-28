/**
 * Admin action password for high-risk admin endpoints, checked on every request.
 *
 * The password is never stored in the repo: ADMIN_ACTION_PASSWORD_HASH is a
 * Worker secret in the form `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`
 * (generate/set it with `npm run admin:set-password`).
 */
import { type Env, supabaseRestWithCount } from './auth';

export const STEP_UP_MAX_FAILURES = 5;
export const STEP_UP_LOCKOUT_MINUTES = 15;
/** Workers' WebCrypto rejects PBKDF2 above 100k iterations. */
const PBKDF2_MAX_ITERATIONS = 100_000;

type ParsedHash = { iterations: number; salt: Uint8Array; hash: Uint8Array };

function b64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function parseHash(raw: string): ParsedHash | null {
  const parts = raw.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_MAX_ITERATIONS) return null;
  try {
    const salt = b64ToBytes(parts[2]!);
    const hash = b64ToBytes(parts[3]!);
    if (salt.length < 16 || hash.length < 32) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

function storedHash(env: Env): ParsedHash | null {
  return parseHash(String(env.ADMIN_ACTION_PASSWORD_HASH || '').trim());
}

export function stepUpConfigured(env: Env): boolean {
  return storedHash(env) !== null;
}

export async function verifyActionPassword(env: Env, password: string): Promise<boolean> {
  const parsed = storedHash(env);
  if (!parsed || !password) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: parsed.salt, iterations: parsed.iterations },
    key,
    parsed.hash.length * 8,
  );
  return timingSafeEqual(new Uint8Array(bits), parsed.hash);
}

/** The client sends the password URI-encoded so any characters survive as a header. */
export function passwordFromRequest(request: Request): string {
  const raw = request.headers.get('X-Admin-Password') || '';
  if (!raw || raw.length > 1024) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

export async function recentStepUpFailures(env: Env, adminUserId: string): Promise<number> {
  const since = new Date(Date.now() - STEP_UP_LOCKOUT_MINUTES * 60 * 1000).toISOString();
  const { total } = await supabaseRestWithCount(
    env,
    `admin_audit_log?actor_admin_id=eq.${encodeURIComponent(adminUserId)}`
      + `&action=eq.step_up_failed&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
  );
  return total ?? 0;
}

export function requiresStepUp(path: string, method: string): boolean {
  if (method === 'DELETE' && /^\/users\/[A-Za-z0-9]{8}$/.test(path)) return true;
  if (method === 'DELETE' && /^\/users\/[A-Za-z0-9]{8}\/scores$/.test(path)) return true;
  if (method === 'POST' && /^\/users\/[A-Za-z0-9]{8}\/impersonate$/.test(path)) return true;
  if (method === 'POST' && /^\/users\/[A-Za-z0-9]{8}\/password-reset$/.test(path)) return true;
  return false;
}
