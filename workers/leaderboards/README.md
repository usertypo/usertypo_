# Leaderboards worker

Cloudflare Worker that serves rankings from **Supabase Postgres**.

- Dev: `usertypo-leaderboards-dev`
- Production: `usertypo-leaderboards`

From the repo root:

```bash
npm run worker:leaderboards:dev
npm run worker:leaderboards:deploy:dev
npm run worker:leaderboards:deploy:prod
```

Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Full notes: [docs/workers/leaderboards.md](../../docs/workers/leaderboards.md)
