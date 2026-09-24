# Theme Assets Worker

Stores custom theme background images in Cloudflare R2.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `PUT` | `/upload` | Clerk JWT | Upload image body (`Content-Type: image/jpeg\|png\|webp\|gif`) |
| `GET` | `/bg/{userId}/{file}` | Public | Serve image |
| `DELETE` | `/bg/{userId}/{file}` | Clerk JWT (owner) | Delete image |
| `GET` | `/health` | Public | Health check |

## Deploy

```bash
# from repo root
npm install --prefix workers/theme-assets
npm run worker:theme-assets:deploy:dev
# optional secret (JWKS fallback works without it):
# cd workers/theme-assets && npx wrangler secret put CLERK_SECRET_KEY --env dev
```

Buckets: `usertypo-theme-bgs-dev` (dev) · `usertypo-theme-bgs` (prod)
