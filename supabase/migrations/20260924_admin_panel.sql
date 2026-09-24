-- Admin panel: bans, reports, visit dwell tracking, audit log.
-- Apply on staging then production. Worker uses service_role for privileged ops.

-- ---------------------------------------------------------------------------
-- Profiles: ban fields
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_banned boolean not null default false;

alter table public.profiles
  add column if not exists banned_at timestamptz;

alter table public.profiles
  add column if not exists banned_reason text;

alter table public.profiles
  add column if not exists banned_by text;

create index if not exists profiles_is_banned_idx
  on public.profiles (is_banned)
  where is_banned = true;

-- ---------------------------------------------------------------------------
-- User reports (in-app moderation queue)
-- ---------------------------------------------------------------------------
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id text,
  reporter_name text,
  reporter_email text,
  reported_user_id text,
  reported_public_id text,
  reason text not null,
  details text not null default '',
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'resolved')),
  resolved_by text,
  resolved_at timestamptz,
  admin_notes text,
  created_at timestamptz not null default now()
);

create index if not exists user_reports_status_created_idx
  on public.user_reports (status, created_at desc);

create index if not exists user_reports_reported_user_idx
  on public.user_reports (reported_user_id)
  where reported_user_id is not null;

alter table public.user_reports enable row level security;

-- No direct client access; admin Worker uses service_role.
drop policy if exists user_reports_no_direct on public.user_reports;
create policy user_reports_no_direct on public.user_reports
  for all
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- Visit sessions (signed-in dwell / time on site)
-- ---------------------------------------------------------------------------
create table if not exists public.visit_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  duration_seconds integer not null default 0
);

create index if not exists visit_sessions_user_started_idx
  on public.visit_sessions (user_id, started_at desc);

create index if not exists visit_sessions_open_idx
  on public.visit_sessions (user_id, last_heartbeat_at desc)
  where ended_at is null;

alter table public.visit_sessions enable row level security;

drop policy if exists visit_sessions_no_direct on public.visit_sessions;
create policy visit_sessions_no_direct on public.visit_sessions
  for all
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- Admin audit log
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id text not null,
  action text not null,
  target_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_admin_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_log_no_direct on public.admin_audit_log;
create policy admin_audit_log_no_direct on public.admin_audit_log
  for all
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- Helpers for analytics (service_role / Worker)
-- ---------------------------------------------------------------------------
create or replace function public.admin_avg_visit_seconds(p_user_id text default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(avg(duration_seconds)::numeric, 0)
  from public.visit_sessions
  where duration_seconds > 0
    and ended_at is not null
    and (p_user_id is null or user_id = p_user_id);
$$;

revoke all on function public.admin_avg_visit_seconds(text) from public;
grant execute on function public.admin_avg_visit_seconds(text) to service_role;
