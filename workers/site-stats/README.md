# Site stats worker

Guest aggregates for the About page (time typed, tests, words, 30s WPM histogram),
merged with signed-in Supabase stats.

- Dev: `usertypo-site-stats-dev`
- Production: `usertypo-site-stats`

```bash
npm run worker:site-stats:deploy:dev
```

Endpoints:

- `GET /public` — About page payload
- `POST /ingest` — guest test counters `{ duration_seconds, words, wpm, mode, amount, failed? }`
- `GET /health`
