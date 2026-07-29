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

## Ads

Visible Sponsored placeholder slots exist on results pages (home, leaderboards, room, dual).
No ad network is wired yet — when you pick a provider, configure scripts / `ads.txt` then.
Ads are not user-toggleable.

## Security notes

- Never paste secret keys into GitHub issues, PRs, or chat.
- Do not weaken Supabase Row Level Security for demos.
- Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
