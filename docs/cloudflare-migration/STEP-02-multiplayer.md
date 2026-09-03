# Step 2 — Multiplayer on Cloudflare

Real-time multiplayer runs on a **Cloudflare Worker + Durable Object** (`usertypo-mp` / `usertypo-mp-dev`).

**Scaling:** lobby DO (`lobby`) for matchmaking + **one DO per duel/room** (`room:{roomId}`).

Frontend config: `js/config/public.js` → `multiplayer.url` + `transport: 'cf'`.

## Secrets

From `workers/multiplayer`:

```bash
npx wrangler secret put CLERK_SECRET_KEY --env dev
npx wrangler secret put SUPABASE_URL --env dev
npx wrangler secret put SUPABASE_ANON_KEY --env dev
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env dev
```

Use `--env production` for production.

## Deploy

```bash
npm run worker:multiplayer:deploy:dev
npm run worker:multiplayer:deploy:prod
```

Health: `https://usertypo-mp-dev.usertypo2026.workers.dev/health`  
WebSocket: `wss://usertypo-mp-dev.usertypo2026.workers.dev/ws`

Local: `npm run worker:multiplayer:dev` then set `MULTIPLAYER_SERVER_URL=http://127.0.0.1:8787` in `.env`.

## Files

| Path | Purpose |
|------|---------|
| `workers/multiplayer/` | CF Worker + `MultiplayerHub` Durable Object |
| `js/api/multiplayer-cf-transport.js` | WebSocket client shim |
| `js/api/multiplayer.js` | SPA multiplayer client |
