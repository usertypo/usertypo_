# Notifications worker

Friend notification inbox on **Cloudflare D1** (staging first). Multiplayer duel/room toasts stay ephemeral in the browser.

- Dev: `usertypo-notifications-dev`
- Production: `usertypo-notifications`

From the repo root:

```bash
npm run worker:notifications:deploy:dev
npm run worker:notifications:deploy:prod
```

**Secrets (recommended on both envs):**
`CLERK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

Service role is preferred for friend-request verification and inbox sync. Without it, the Worker falls back to the caller's Clerk JWT (which can fail for some lookups and leave the recipient inbox empty).

`CLERK_FRONTEND_API`, `SUPABASE_URL`, and anon key are in `wrangler.toml` vars.

Recipient clients also self-heal by:
1. `POST /notifications/sync` — backfill pending Postgres friend requests into D1
2. Client dashboard backfill — shows pending requests even if emit/sync failed

D1 schema: `schema.sql` — run after creating the database:

```bash
npm run d1:migrate:dev --prefix workers/notifications
```

To allow `friend_online` rows on an existing database (rebuilds the table CHECK):

```bash
npm run d1:migrate:friend-online:dev --prefix workers/notifications
```
