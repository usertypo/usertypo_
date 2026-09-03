# Architecture

usertypo_ runs entirely on Cloudflare, with Clerk for auth and Supabase for Postgres.

| Layer | Host | Role |
|-------|------|------|
| Site | Cloudflare Pages | SPA at usertypo.com / dev.usertypo.com |
| Multiplayer | Worker `usertypo-mp` + Durable Objects | Races, rooms, matchmaking |
| Leaderboards | Worker `usertypo-leaderboards` | Rankings via Postgres RPCs |
| Database | Supabase Postgres | Profiles, sessions, friends, RLS |
| Auth | Clerk | Sign-in / sessions |

Deploy notes: [leaderboards](./cloudflare-migration/STEP-01-leaderboards.md) · [multiplayer](./cloudflare-migration/STEP-02-multiplayer.md)
