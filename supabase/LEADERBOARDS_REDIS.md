# Upstash Redis Leaderboards (usertypo_)

This project uses **Postgres for history** and **Upstash Redis Sorted Sets for rankings**.

The browser never sees Redis secrets. All Redis traffic goes through a Supabase Edge Function.

## Architecture

1. User finishes a test → save row to `typing_sessions` (Postgres) as usual
2. If the score qualifies → call Edge Function `leaderboards` action `ingest`
3. Edge Function updates Redis ZSETs with `ZADD ... GT` (only if WPM improved)
4. Leaderboard page / rank widgets call action `top` / `rank`
5. If Redis is not configured yet, the frontend automatically falls back to the existing Postgres RPC

## Redis key layout

```
lb:v1:{mode}:{amount}:alltime
lb:v1:{mode}:{amount}:daily:YYYY-MM-DD
lb:v1:{mode}:{amount}:weekly:YYYY-Www

meta:lb:v1:...   → hash of user_id → { accuracy, raw_wpm, consistency, created_at }
```

Monthly boards are removed.

## All-time eligibility

All-time Redis + Postgres boards only include scores where:
- the user has completed **at least 50** non-failed tests (any mode)
- that score’s **WPM is at least 30**

Daily and weekly boards have **no** min-test / min-WPM gates.

## Exact setup steps (do these once)

### A) Create a free Upstash Redis database

1. Go to [https://console.upstash.com](https://console.upstash.com)
2. Sign up / log in
3. Click **Create Database**
4. Choose:
   - Type: **Regional**
   - Region: pick one close to your Supabase region (`eu-north-1` → prefer nearby EU)
   - Name: `usertypo-leaderboards`
5. Create it
6. Open the database → **REST API** section
7. Copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### B) Add those secrets to Supabase Edge Functions

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → select your project
2. Go to **Edge Functions** → **Secrets** (or Project Settings → Edge Functions → Secrets)
3. Add these two secrets exactly:

| Name | Value |
|------|--------|
| `UPSTASH_REDIS_REST_URL` | paste from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | paste from Upstash |

4. Save

Supabase already provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions automatically. You do **not** put those in the browser.

### C) Confirm the Edge Function is deployed

Function name: `leaderboards`  
URL shape: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/leaderboards`

If you change the function source later, redeploy from this folder:

```bash
npx supabase functions deploy leaderboards --project-ref YOUR_PROJECT_REF
```

### D) Do NOT put Upstash values in frontend files

Never put Redis URL/token in:
- `js/config/public.js`
- `.env` values that get injected into the browser
- any page HTML/JS

Only `.env.example` documents the names for server/ops reference.

## What qualifies for Redis ingest?

A score is written to Redis only when:
- user is signed in
- test is not failed
- WPM > 0
- profile `show_on_leaderboard` is true

`ZADD GT` means Redis only updates when the new WPM is higher than that user's current score in that board.

## Backfill note

Existing Postgres scores are **not** automatically copied into Redis. After Redis is configured:
1. Complete a new qualifying test, or
2. Ask for a one-time backfill script (safe admin/service-role job)

Until Redis secrets exist, the app keeps using the Postgres leaderboard RPCs so nothing breaks.
