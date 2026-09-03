# Leaderboards worker

Leaderboards are served by a **Cloudflare Worker** using **Supabase Postgres** (`usertypo-leaderboards` / `usertypo-leaderboards-dev`).

Frontend config: `js/config/public.js` → `leaderboards.url`.

## Deploy

```bash
npm run worker:leaderboards:deploy:dev
npm run worker:leaderboards:deploy:prod
```

Secrets (per environment): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Health: `https://usertypo-leaderboards-dev.usertypo2026.workers.dev/health`

Local override: set `LEADERBOARDS_WORKER_URL` in `.env` and run `npm run dev`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 missing_auth` on ingest | Sign in; Clerk instance must match the worker environment |
| CORS error in browser | Add your origin to `ALLOWED_ORIGINS` in `workers/leaderboards/wrangler.toml` |
| Empty leaderboards | Complete a signed-in test on a supported preset |
