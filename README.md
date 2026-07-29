# usertypo_

A modern typing-test web app with profiles, friends, leaderboards, and real-time multiplayer races.

**Live site:** [https://usertypo.com](https://usertypo.com)  
**Multiplayer / API:** [https://mp.usertypo.com](https://mp.usertypo.com)  
**Repository:** [https://github.com/usertypo/usertypo](https://github.com/usertypo/usertypo)

License: [AGPLv3](./LICENSE)

> **For the site owner:** Making this repository public lets anyone **read and fork** the code. It does **not** let strangers push to `main`, change your Cloudflare/Render deploy, or access your database, Redis, or Clerk users. Other people can only propose changes by opening a Pull Request, which you can accept or reject.

## Architecture

| Layer | Host | Role |
|-------|------|------|
| Static frontend (SPA) | Cloudflare Pages | HTML/CSS/JS at usertypo.com |
| Backend + Socket.IO | Render | Auth-backed API, multiplayer at mp.usertypo.com |
| Database + Edge Functions | Supabase | Postgres, RLS, leaderboard Edge Function |
| Leaderboard cache | Upstash Redis | Sorted sets via Edge Function only |
| Auth | Clerk | Sign-in / sessions |

Publishable/anon keys in `js/config/public.js` are safe to ship in the browser (and in a public repo). **Secret** keys (`sk_…`, `service_role`, Upstash tokens) stay only in Render / Supabase Edge / Clerk dashboards — never in committed files.

## Local setup

1. Clone the repo and install dependencies:

```bash
npm ci
```

2. Copy `.env.example` → `.env` and fill in your own Clerk / Supabase / multiplayer values (placeholders only in the example file).

3. Run the local server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm start` | Express + Socket.IO app |
| `npm run build:pages` | Rebuild `js/page-fragments.js` from `pages/` |
| `npm run build:cloudflare` | Build static `dist/` for Cloudflare Pages |
| `npm test` | Node test suite |

## Environment variables (names only)

| Name | Where | Secret? |
|------|-------|---------|
| `CLERK_PUBLISHABLE_KEY` | Browser / `.env` | No |
| `CLERK_SECRET_KEY` | Render | **Yes** |
| `SUPABASE_URL` | Browser + server | No (URL) |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | Browser | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Render / Edge | **Yes** |
| `ALLOWED_ORIGINS` | Render | No |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Supabase Edge secrets | **Yes** |
| `WEB3FORMS_ACCESS_KEY` / `RESEND_API_KEY` | Server (optional contact) | **Yes** |
| `SELF_PING_ENABLED` / `SELF_PING_URL` | Render keep-awake | No |

See `.env.example` and `supabase/LEADERBOARDS_REDIS.md` for setup details.

## Ads (Monetag) — scaffold only

Ads are **disabled** by default (`ads.monetag.enabled: false` in `js/config/public.js`).

- Empty ad slot containers exist on home results, user stats, leaderboards, and friends.
- Root [`ads.txt`](./ads.txt) is an empty placeholder so `https://usertypo.com/ads.txt` can return 200 after deploy.
- When you are ready to monetize: get Monetag zone IDs + seller lines, paste them into config / `ads.txt`, set `enabled: true`, and redeploy. Do not commit secrets; Monetag zone IDs for display ads are typically public config.

## Security notes

- Never paste secret keys into GitHub issues, PRs, or chat.
- Do not weaken Supabase Row Level Security for demos.
- Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
