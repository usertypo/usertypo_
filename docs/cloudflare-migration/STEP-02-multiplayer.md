# Step 2 — Multiplayer on Cloudflare (dev first)

This step deploys a **Cloudflare Worker + Durable Object** for real-time multiplayer (dual races, friend challenges, bot races). **Production** (`mp.usertypo.com` on Render) stays unchanged until dev is verified.

---

## What moves where

| Component | Before (dev) | After (dev) |
|-----------|--------------|-------------|
| Multiplayer server | Render `usertypo-dev.onrender.com` | CF Worker `usertypo-mp-dev` |
| Transport | Socket.IO | Native WebSocket (Socket.IO-compatible client shim) |
| State | In-memory on Render | Durable Object `MultiplayerHub` |
| Auth / profiles / friends | Supabase (unchanged) | Supabase (unchanged) |

**Phase A (this step):** public duels, friend challenges, bot races, match join/resume, race progress/cursor.  
**Phase B (later):** custom rooms (`/room`) — not yet on CF.

---

## Part A — Install dependencies

```bash
cd workers/multiplayer
npm install
```

If you are not logged in to Cloudflare yet:

```bash
npx wrangler login
npx wrangler whoami
```

---

## Part B — Add secrets (dev worker)

From `workers/multiplayer`, set secrets for the **dev** environment:

### B1 — Clerk (Development)

1. Open [Clerk Dashboard](https://dashboard.clerk.com) → your **Development** instance
2. **Configure → API Keys** → copy **Secret key** (`sk_test_...`)

```bash
npx wrangler secret put CLERK_SECRET_KEY --env dev
```

Paste your dev Clerk secret key.

Optional (if you use JWT verification key):

```bash
npx wrangler secret put CLERK_JWT_KEY --env dev
```

### B2 — Supabase (dev project `dzpbkyqsshdruwhffwhw`)

Same keys as Step 1 leaderboards:

```bash
npx wrangler secret put SUPABASE_URL --env dev
```
Paste: `https://dzpbkyqsshdruwhffwhw.supabase.co`

```bash
npx wrangler secret put SUPABASE_ANON_KEY --env dev
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env dev
```

---

## Part C — Deploy the dev worker

```bash
npm run deploy:dev
```

Or from repo root:

```bash
npm run worker:multiplayer:deploy:dev
```

Note the deploy URL, e.g.:

`https://usertypo-mp-dev.usertypo2026.workers.dev`

### Health check

Open in browser:

`https://usertypo-mp-dev.usertypo2026.workers.dev/health`

Expected: `{"ok":true,"service":"usertypo-multiplayer-gateway"}`

WebSocket endpoint: `wss://usertypo-mp-dev.usertypo2026.workers.dev/ws`

---

## Part D — Frontend config (already in `dev` branch)

`js/config/public.js` staging block should point dev to the CF worker:

```javascript
cfg.multiplayer = {
  url: 'https://usertypo-mp-dev.usertypo2026.workers.dev',
  transport: 'cf',
};
```

Push to the **`dev`** branch so Cloudflare Pages rebuilds `dev.usertypo.com`.

---

## Part E — Test on dev.usertypo.com

1. Open **https://dev.usertypo.com/multiplayer** (or `/dual`)
2. Open browser DevTools → **Network** → filter **WS**
3. You should see a WebSocket to `usertypo-mp-dev...workers.dev/ws`
4. Test:
   - **Find a dual** (public listing) — two browsers/accounts
   - **Play vs bot**
   - **Challenge a friend** (signed-in users who are friends)
   - Full race: countdown → typing → results

### If connection fails

- Confirm secrets are set (`wrangler secret list --env dev`)
- Confirm Clerk **authorized parties** include `https://dev.usertypo.com` (set in `wrangler.toml` vars)
- Check worker logs: `npx wrangler tail --env dev`

---

## Part F — Production (do not run until dev is stable)

When dev multiplayer works for a few days:

1. Set **production** Clerk + Supabase secrets on `--env production`
2. `npm run deploy:prod`
3. Update `js/config/public.js` production `multiplayer.url` + `transport: 'cf'`
4. Merge `dev` → `main`, verify `usertypo.com`
5. Decommission Render multiplayer (`mp.usertypo.com`) after soak period

---

## Files added/changed

| Path | Purpose |
|------|---------|
| `workers/multiplayer/` | CF Worker + `MultiplayerHub` Durable Object |
| `js/api/multiplayer-cf-transport.js` | WebSocket client shim (Socket.IO-like API) |
| `js/api/multiplayer.js` | Auto-selects CF transport when `transport: 'cf'` |
| `js/config/public.js` | Dev staging points to CF worker |

---

## Rollback (dev)

In `js/config/public.js` staging block, revert to Render:

```javascript
cfg.multiplayer = { url: 'https://usertypo-dev.onrender.com' };
```

Remove `transport: 'cf'`. Push to `dev`. No worker delete required.
