import { verifyToken } from '@clerk/backend';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Env {
  ENVIRONMENT?: string;
  PUBLIC_SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_FRONTEND_API?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_JWT_KEY?: string;
  THEME_BGS: R2Bucket;
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

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function requireUserId(env: Env, request: Request): Promise<string> {
  const token = bearerToken(request);
  if (!token) throw new Error('missing_token');

  if (env.CLERK_SECRET_KEY || env.CLERK_JWT_KEY) {
    const options: Record<string, unknown> = {};
    if (env.CLERK_SECRET_KEY) options.secretKey = env.CLERK_SECRET_KEY;
    if (env.CLERK_JWT_KEY) options.jwtKey = env.CLERK_JWT_KEY.replace(/\\n/g, '\n');
    const parties = authorizedParties(env);
    if (parties.length) options.authorizedParties = parties;
    const verified = await verifyToken(token, options);
    if (!verified?.sub) throw new Error('invalid_token');
    return String(verified.sub);
  }

  const frontendApi = String(env.CLERK_FRONTEND_API || '').trim().replace(/^https?:\/\//, '');
  if (!frontendApi) throw new Error('clerk_not_configured');
  const JWKS = createRemoteJWKSet(new URL(`https://${frontendApi}/.well-known/jwks.json`));
  const parties = authorizedParties(env);
  const { payload } = await jwtVerify(token, JWKS, { clockTolerance: 10 });
  if (!payload?.sub) throw new Error('invalid_token');
  if (parties.length) {
    const azp = String(payload.azp || '');
    if (azp && !parties.includes(azp)) throw new Error('invalid_token');
  }
  return String(payload.sub);
}

export { bearerToken };
