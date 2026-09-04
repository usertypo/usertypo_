# Notifications worker

Friend notification inbox on **Cloudflare D1** (staging first). Multiplayer duel/room toasts stay ephemeral in the browser.

- Dev: `usertypo-notifications-dev`
- Production: `usertypo-notifications` (not cut over yet)

From the repo root:

```bash
npm run worker:notifications:deploy:dev
```

Secrets (optional on staging — JWKS auth works without them):
`CLERK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

`CLERK_FRONTEND_API`, `SUPABASE_URL`, and anon key are in `wrangler.toml` vars.

D1 schema: `schema.sql` — run after creating the database:

```bash
npm run d1:migrate:dev --prefix workers/notifications
```
