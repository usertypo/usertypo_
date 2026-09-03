# Multiplayer worker

Cloudflare Worker + Durable Objects for real-time races and rooms.

- Dev: `usertypo-mp-dev`
- Production: `usertypo-mp`

From the repo root:

```bash
npm run worker:multiplayer:dev
npm run worker:multiplayer:deploy:dev
npm run worker:multiplayer:deploy:prod
```

Secrets: `CLERK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Full notes: [docs/workers/multiplayer.md](../../docs/workers/multiplayer.md)
