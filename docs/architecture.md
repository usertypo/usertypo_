# Architecture

usertypo_ runs entirely on Cloudflare, with Clerk for auth and Supabase for Postgres.

| Layer | Host | Role |
|-------|------|------|
| Site | Cloudflare Pages | SPA at usertypo.com / dev.usertypo.com |
| Multiplayer | Worker `usertypo-mp` + Durable Objects | Races, rooms, matchmaking |
| Leaderboards | Worker `usertypo-leaderboards` | Rankings via Postgres RPCs |
| Database | Supabase Postgres | Profiles, sessions, friends, RLS |
| Auth | Clerk | Sign-in / sessions |

Worker notes: [leaderboards](./workers/leaderboards.md) · [multiplayer](./workers/multiplayer.md)
