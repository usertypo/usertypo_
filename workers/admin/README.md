# Admin Worker

Privileged API for allowlisted admins (`TE2CGW6Y`, `XRMXYTTF`, `D94QTBHG`).

## Setup

1. Apply [`supabase/sql/admin.sql`](../../supabase/sql/admin.sql) on the target Supabase project.
2. `cd workers/admin && npm install`
3. Set secrets:
   ```bash
   npx wrangler secret put CLERK_SECRET_KEY --env dev
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env dev
   ```
4. Deploy: `npm run worker:admin:deploy:dev` from repo root.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | none |
| POST | `/presence/heartbeat` | signed-in |
| POST | `/presence/end` | signed-in |
| POST | `/reports` | optional (create) |
| GET | `/me` | admin |
| GET | `/analytics` | admin |
| GET | `/users?q=` | admin |
| GET | `/users/:publicId` | admin |
| POST | `/users/:publicId/ban` | admin |
| POST | `/users/:publicId/unban` | admin |
| DELETE | `/users/:publicId/scores` | admin |
| POST | `/users/:publicId/impersonate` | admin |
| POST | `/impersonate/end` | impersonating session |
| GET | `/reports` | admin |
| PATCH | `/reports/:id` | admin |
| POST | `/users/:publicId/password-reset` | admin |
| POST | `/users/:publicId/clear-username` | admin |
