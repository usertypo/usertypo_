# Step 1 — Leaderboards on Cloudflare (remove Upstash + Supabase Edge Function)

This step deploys a **Cloudflare Worker** that serves leaderboards using **Supabase Postgres only** (no Upstash Redis).

Production (`usertypo.com`) is **not changed** until you complete Step 1 on **dev** and paste the worker URL into config.

---

## What you need before starting

- Cloudflare account with **Workers Paid** ($5/month) active
- Access to your **dev Supabase** project (`dzpbkyqsshdruwhffwhw`) dashboard
- **Clerk Development** keys (for `dev.usertypo.com`)
- Node.js 20+ installed on your PC
- This repo open in Cursor / terminal at the `usertypo_` folder

---

## Part A — Log in to Cloudflare (one time)

1. Open a terminal in Cursor: **Terminal → New Terminal**
2. Run:

```bash
cd workers/leaderboards
npm install
npx wrangler login
```

3. Your browser opens. **Log in to Cloudflare** and click **Allow**.
4. When the terminal says you are logged in, run:

```bash
npx wrangler whoami
```

You should see your Cloudflare account email.

---

## Part B — Add secrets to the **dev** worker

Secrets are private values (Supabase keys). They are stored in Cloudflare, not in git.

### B1 — Get your dev Supabase keys

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Click project **`dzpbkyqsshdruwhffwhw`** (dev)
3. Left sidebar → **Project Settings** (gear icon at bottom)
4. Click **API**
5. Copy and keep these somewhere temporary (Notepad):
   - **Project URL** → e.g. `https://dzpbkyqsshdruwhffwhw.supabase.co`
   - **anon public** key (or publishable key)
   - **service_role** key (**secret** — never put in git or chat)

### B2 — Set secrets in the terminal

Still in `workers/leaderboards`, run each command. When prompted, paste the value and press Enter.

**Dev environment:**

```bash
npx wrangler secret put SUPABASE_URL --env dev
```
Paste: `https://dzpbkyqsshdruwhffwhw.supabase.co`

```bash
npx wrangler secret put SUPABASE_ANON_KEY --env dev
```
Paste: your dev **anon** key

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env dev
```
Paste: your dev **service_role** key

---

## Part C — Deploy the dev worker

From `workers/leaderboards`:

```bash
npm run deploy:dev
```

At the end you will see a URL like:

```text
https://usertypo-leaderboards-dev.<YOUR-SUBDOMAIN>.workers.dev
```

**Copy that full URL** (no trailing slash).

### Test health endpoint

Open in browser:

```text
https://usertypo-leaderboards-dev.<YOUR-SUBDOMAIN>.workers.dev/health
```

You should see: `{"ok":true,"service":"usertypo-leaderboards"}`

---

## Part D — Point dev site at the worker

1. Open `js/config/public.js` in the repo
2. Find `applyStagingConfig()` → `cfg.leaderboards`
3. Set:

```javascript
cfg.leaderboards = {
    url: 'https://usertypo-leaderboards-dev.YOUR-SUBDOMAIN.workers.dev',
};
```

4. Commit and push to the **`dev`** branch (Cloudflare Pages deploys dev from `dev`)

Or test locally:

```bash
npm run dev
```

Open `http://localhost:3000`, sign in with **Clerk dev**, complete a test, open **Leaderboards**.

---

## Part E — Verify on dev.usertypo.com

1. Wait for Cloudflare Pages to finish deploying the `dev` branch
2. Open [https://dev.usertypo.com/leaderboards](https://dev.usertypo.com/leaderboards)
3. Sign in (Clerk **Development** instance)
4. Check browser DevTools → **Network**:
   - Requests should go to `usertypo-leaderboards-dev....workers.dev`
   - **Not** to `/functions/v1/leaderboards`
5. Complete a typing test while signed in — score should appear on leaderboards (may take a page refresh)

---

## Part F — Production (only after dev works)

Repeat **Part B** with **production** Supabase (`skebosepedaxnvcaizka`) using `--env production`:

```bash
npx wrangler secret put SUPABASE_URL --env production
npx wrangler secret put SUPABASE_ANON_KEY --env production
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
npm run deploy:prod
```

Then set in `js/config/public.js` (top-level, not staging):

```javascript
leaderboards: {
    url: 'https://usertypo-leaderboards.YOUR-SUBDOMAIN.workers.dev',
},
```

Deploy **`main`** branch to Pages.

### Optional: custom domain

In Cloudflare Dashboard → **Workers & Pages** → **usertypo-leaderboards** → **Settings** → **Domains & Routes** → add e.g. `lb.usertypo.com`.

---

## What you can turn off after prod cutover

| Service | When safe to remove |
|---------|---------------------|
| **Upstash Redis** | After prod worker URL is live and leaderboards work |
| **Supabase Edge Function `leaderboards`** | Same — Postgres RPCs + Worker replace it |

Do **not** delete Upstash until you have tested prod for a few days.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `401 missing_auth` on ingest | Sign in on dev; Clerk dev must match Supabase dev integration |
| CORS error in browser | Add your origin to `ALLOWED_ORIGINS` in `workers/leaderboards/wrangler.toml` |
| Empty leaderboards | Normal for new dev accounts; complete a test while signed in |
| Still hits Supabase `/functions/v1/leaderboards` | `leaderboards.url` is empty in config — paste worker URL |

---

## Next step

**Step 2** — Multiplayer on Cloudflare Durable Objects (replace Render). We will do that after Step 1 is verified on dev.
