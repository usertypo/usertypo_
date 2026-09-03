# usertypo_

A modern typing-test web app with profiles, friends, leaderboards, and real-time multiplayer races.

**Live site:** [https://usertypo.com](https://usertypo.com)  
**Repository:** [https://github.com/usertypo/usertypo](https://github.com/usertypo/usertypo)

License: [AGPLv3](./LICENSE)

> **For the site owner:** Making this repository public lets anyone **read and fork** the code. It does **not** let strangers push to `main`, change your Cloudflare deploy, or access your database or Clerk users. Other people can only propose changes by opening a Pull Request, which you can accept or reject.

## Architecture

| Layer | Host | Role |
|-------|------|------|
| Static frontend (SPA) | Cloudflare Pages | HTML/CSS/JS at usertypo.com |
| Multiplayer | Cloudflare Workers + Durable Objects | Real-time races (`usertypo-mp`) |
| Leaderboards | Cloudflare Worker + Supabase Postgres | Rankings (`usertypo-leaderboards`) |
| Database | Supabase | Postgres, RLS |
| Auth | Clerk | Sign-in / sessions |

Publishable/anon keys in `js/config/public.js` are safe to ship in the browser (and in a public repo). **Secret** keys (`sk_…`, `service_role`) stay only in Cloudflare Worker secrets / Clerk dashboards — never in committed files.

## Local setup

1. Clone the repo and install dependencies:

```bash
npm ci
```

2. Copy `.env.example` → `.env` and fill in your own Clerk / Supabase values (placeholders only in the example file).

3. Run the local static server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Multiplayer and leaderboards use the Cloudflare workers in `js/config/public.js` unless you override `MULTIPLAYER_SERVER_URL` / `LEADERBOARDS_WORKER_URL`. To run workers locally: `npm run worker:multiplayer:dev` and `npm run worker:leaderboards:dev`.

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm run dev` / `npm start` | Local Express static SPA + `/api/geo` |
| `npm run build:pages` | Rebuild `js/page-fragments.js` from `pages/` |
| `npm run build:cloudflare` | Build static `dist/` for Cloudflare Pages |
| `npm test` | Node test suite |
| `npm run worker:multiplayer:deploy:dev` | Deploy multiplayer worker (dev) |
| `npm run worker:leaderboards:deploy:dev` | Deploy leaderboards worker (dev) |

## Environment variables (names only)

| Name | Where | Secret? |
|------|-------|---------|
| `CLERK_PUBLISHABLE_KEY` | Browser / `.env` | No |
| `CLERK_SECRET_KEY` | Cloudflare Worker secrets | **Yes** |
| `SUPABASE_URL` | Browser + workers | No (URL) |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | Browser | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Worker secrets | **Yes** |
| `ALLOWED_ORIGINS` | Worker `wrangler.toml` | No |
| `MULTIPLAYER_SERVER_URL` | Local `.env` override | No |
| `LEADERBOARDS_WORKER_URL` | Local `.env` override | No |
| `WEB3FORMS_ACCESS_KEY` / `RESEND_API_KEY` | Optional contact | **Yes** |

See [docs/architecture.md](./docs/architecture.md) for the current stack.

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
