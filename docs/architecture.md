# Architecture

usertypo_ runs entirely on Cloudflare, with Clerk for auth and Supabase for Postgres.

| Layer | Host | Role |
|-------|------|------|
| Site | Cloudflare Pages | SPA at usertypo.com / dev.usertypo.com |
| Multiplayer | Worker `usertypo-mp` + Durable Objects | Races, rooms, matchmaking |
| Leaderboards | Worker `usertypo-leaderboards` | Rankings via Postgres RPCs |
| Site stats | Worker `usertypo-site-stats` + DO | Guest aggregates for About page |
| Notifications | Worker `usertypo-notifications` + D1 | Friend inbox (staging); multiplayer toasts stay WS |
| Database | Supabase Postgres | Profiles, sessions, friends, RLS |
| Auth | Clerk | Sign-in / sessions |

Worker notes: [leaderboards](./workers/leaderboards.md) · [multiplayer](./workers/multiplayer.md) · [site-stats](../workers/site-stats/README.md) · [notifications](../workers/notifications/README.md)
