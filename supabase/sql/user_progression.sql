-- User XP / levels / streaks — server-authoritative awards on typing_sessions insert.

create table if not exists public.user_progression (
  user_id text primary key references public.profiles(user_id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  level integer not null default 1 check (level >= 1),
  xp_into_level integer not null default 0 check (xp_into_level >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_play_date date,
  daily_xp integer not null default 0 check (daily_xp >= 0),
  daily_xp_date date,
  updated_at timestamptz not null default now()
);

create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  session_id uuid not null references public.typing_sessions(id) on delete cascade,
  xp_awarded integer not null check (xp_awarded >= 0),
  leveled_up boolean not null default false,
  level_before integer not null,
  level_after integer not null,
  streak_after integer not null default 0,
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint xp_events_session_unique unique (session_id)
);

create index if not exists xp_events_user_created_idx
  on public.xp_events (user_id, created_at desc);

alter table public.user_progression enable row level security;
alter table public.xp_events enable row level security;

drop policy if exists "Users can view own progression" on public.user_progression;
create policy "Users can view own progression"
  on public.user_progression for select
  using (user_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Users can view friends progression" on public.user_progression;
create policy "Users can view friends progression"
  on public.user_progression for select
  using (
    exists (
      select 1
      from public.friendships f
      where f.user_id = (select auth.jwt() ->> 'sub')
        and f.friend_id = user_progression.user_id
    )
  );

drop policy if exists "Users can view own xp events" on public.xp_events;
create policy "Users can view own xp events"
  on public.xp_events for select
  using (user_id = (select auth.jwt() ->> 'sub'));

-- XP needed to advance from level L → L+1
create or replace function public.xp_needed_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  select greatest(1, floor(100 * power(greatest(p_level, 1)::numeric, 1.45))::integer);
$$;

create or replace function public.level_title(p_level integer)
returns text
language sql
immutable
as $$
  select case
    when p_level >= 100 then 'Legend'
    when p_level >= 75 then 'Elite'
    when p_level >= 50 then 'Sharp'
    when p_level >= 25 then 'Fluent'
    when p_level >= 10 then 'Typist'
    else 'Novice'
  end;
$$;

create or replace function public.compute_level_from_total_xp(p_total_xp integer)
returns table (level integer, xp_into_level integer, xp_to_next integer)
language plpgsql
immutable
as $$
declare
  v_level integer := 1;
  v_remaining integer := greatest(coalesce(p_total_xp, 0), 0);
  v_need integer;
begin
  loop
    v_need := public.xp_needed_for_level(v_level);
    exit when v_remaining < v_need;
    v_remaining := v_remaining - v_need;
    v_level := v_level + 1;
    -- safety against runaway loops
    exit when v_level > 10000;
  end loop;

  level := v_level;
  xp_into_level := v_remaining;
  xp_to_next := public.xp_needed_for_level(v_level);
  return next;
end;
$$;

create or replace function public.streak_xp_multiplier(p_streak integer)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_streak, 0) >= 14 then 2.0
    when coalesce(p_streak, 0) >= 7 then 1.3
    when coalesce(p_streak, 0) >= 3 then 1.15
    else 1.0
  end;
$$;

create or replace function public.apply_daily_xp_soft_cap(p_daily_xp integer, p_gain integer)
returns integer
language plpgsql
immutable
as $$
declare
  v_daily integer := greatest(coalesce(p_daily_xp, 0), 0);
  v_gain integer := greatest(coalesce(p_gain, 0), 0);
  v_room integer;
  v_over integer;
begin
  if v_gain <= 0 then
    return 0;
  end if;

  if v_daily >= 400 then
    return greatest(1, floor(v_gain * 0.25)::integer);
  end if;

  v_room := 400 - v_daily;
  if v_gain <= v_room then
    return v_gain;
  end if;

  v_over := v_gain - v_room;
  return v_room + greatest(1, floor(v_over * 0.25)::integer);
end;
$$;

create or replace function public.ensure_user_progression(p_user_id text)
returns public.user_progression
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_progression;
begin
  if p_user_id is null or trim(p_user_id) = '' then
    raise exception 'invalid_user';
  end if;

  insert into public.user_progression (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.user_progression
  where user_id = p_user_id;

  return v_row;
end;
$$;

create or replace function public.award_session_xp(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.typing_sessions%rowtype;
  v_prog public.user_progression%rowtype;
  v_existing public.xp_events%rowtype;
  v_play_date date;
  v_base integer := 0;
  v_acc_mult numeric := 1.0;
  v_wpm_mult numeric := 1.0;
  v_mod_mult numeric := 1.0;
  v_streak_mult numeric := 1.0;
  v_pb_bonus integer := 0;
  v_raw integer := 0;
  v_awarded integer := 0;
  v_avg_wpm numeric;
  v_sample_count integer := 0;
  v_new_streak integer;
  v_level_before integer;
  v_total_before integer;
  v_total_after integer;
  v_level_after integer;
  v_xp_into integer;
  v_xp_to_next integer;
  v_leveled_up boolean := false;
  v_daily_xp integer;
  v_reason jsonb;
  v_level_info record;
begin
  if p_session_id is null then
    return jsonb_build_object('skipped', true, 'reason', 'missing_session');
  end if;

  select * into v_existing
  from public.xp_events
  where session_id = p_session_id;

  if found then
    select * into v_prog from public.user_progression where user_id = v_existing.user_id;
    return jsonb_build_object(
      'skipped', false,
      'duplicate', true,
      'xpGained', v_existing.xp_awarded,
      'leveledUp', v_existing.leveled_up,
      'levelBefore', v_existing.level_before,
      'newLevel', v_existing.level_after,
      'totalXp', coalesce(v_prog.total_xp, 0),
      'xpIntoLevel', coalesce(v_prog.xp_into_level, 0),
      'xpToNext', public.xp_needed_for_level(coalesce(v_prog.level, 1)),
      'streak', v_existing.streak_after,
      'longestStreak', coalesce(v_prog.longest_streak, 0),
      'title', public.level_title(coalesce(v_prog.level, 1)),
      'reason', v_existing.reason
    );
  end if;

  select * into v_session
  from public.typing_sessions
  where id = p_session_id;

  if not found then
    return jsonb_build_object('skipped', true, 'reason', 'session_not_found');
  end if;

  if v_session.failed or coalesce(v_session.wpm, 0) <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'failed_or_zero_wpm');
  end if;

  v_play_date := (timezone('utc', coalesce(v_session.created_at, now())))::date;

  v_prog := public.ensure_user_progression(v_session.user_id);
  v_level_before := v_prog.level;
  v_total_before := v_prog.total_xp;

  -- Base XP from actual finish time only (faster → more XP). Mode/amount ignored.
  -- base = min(80, max(1, floor(1200 / duration_seconds)))
  -- e.g. ≤15s → 80, 30s → 40, 60s → 20, 120s → 10, 300s → 4
  v_base := least(
    80,
    greatest(1, floor(1200.0 / greatest(coalesce(v_session.duration_seconds, 1), 1))::integer)
  );

  -- Accuracy only cuts XP below 100% (never a bonus). Consistency is ignored.
  v_acc_mult := greatest(0, least(1, coalesce(v_session.accuracy, 0) / 100.0));

  -- Soft WPM bonus vs personal average (sessions before this one only)
  select coalesce(avg(ts.wpm), 0), count(*)::integer
    into v_avg_wpm, v_sample_count
  from public.typing_sessions ts
  where ts.user_id = v_session.user_id
    and ts.failed = false
    and ts.wpm > 0
    and ts.id <> v_session.id
    and (
      ts.created_at < v_session.created_at
      or (ts.created_at = v_session.created_at and ts.id::text < v_session.id::text)
    );

  if v_sample_count < 5 then
    if v_session.wpm >= 80 then
      v_wpm_mult := 1.25;
    elsif v_session.wpm >= 50 then
      v_wpm_mult := 1.1;
    else
      v_wpm_mult := 1.0;
    end if;
  else
    if v_session.wpm >= v_avg_wpm * 1.15 then
      v_wpm_mult := 1.25;
    elsif v_session.wpm >= v_avg_wpm * 1.05 then
      v_wpm_mult := 1.1;
    else
      v_wpm_mult := 1.0;
    end if;
  end if;

  if v_session.punctuation or v_session.numbers then
    v_mod_mult := 1.15;
  end if;

  if v_session.is_pb then
    v_pb_bonus := 50;
  end if;

  -- Streak update (UTC calendar day)
  if v_prog.last_play_date is null then
    v_new_streak := 1;
  elsif v_prog.last_play_date = v_play_date then
    v_new_streak := greatest(v_prog.current_streak, 1);
  elsif v_prog.last_play_date = v_play_date - 1 then
    v_new_streak := v_prog.current_streak + 1;
  else
    v_new_streak := 1;
  end if;

  v_streak_mult := public.streak_xp_multiplier(v_new_streak);

  v_raw := greatest(
    1,
    floor(v_base * v_acc_mult * v_wpm_mult * v_mod_mult * v_streak_mult)::integer
  ) + v_pb_bonus;

  -- Reset daily XP counter if new UTC day
  if v_prog.daily_xp_date is distinct from v_play_date then
    v_daily_xp := 0;
  else
    v_daily_xp := v_prog.daily_xp;
  end if;

  v_awarded := public.apply_daily_xp_soft_cap(v_daily_xp, v_raw);
  v_total_after := v_total_before + v_awarded;

  select * into v_level_info
  from public.compute_level_from_total_xp(v_total_after);

  v_level_after := v_level_info.level;
  v_xp_into := v_level_info.xp_into_level;
  v_xp_to_next := v_level_info.xp_to_next;
  v_leveled_up := v_level_after > v_level_before;

  v_reason := jsonb_build_object(
    'base', v_base,
    'durationSeconds', coalesce(v_session.duration_seconds, 0),
    'accuracyMult', v_acc_mult,
    'wpmMult', v_wpm_mult,
    'modifierMult', v_mod_mult,
    'streakMult', v_streak_mult,
    'pbBonus', v_pb_bonus,
    'rawBeforeCap', v_raw,
    'softCapped', v_awarded < v_raw,
    'mode', v_session.mode,
    'amount', v_session.amount,
    'isPb', v_session.is_pb
  );

  update public.user_progression
  set
    total_xp = v_total_after,
    level = v_level_after,
    xp_into_level = v_xp_into,
    current_streak = v_new_streak,
    longest_streak = greatest(longest_streak, v_new_streak),
    last_play_date = v_play_date,
    daily_xp = v_daily_xp + v_awarded,
    daily_xp_date = v_play_date,
    updated_at = now()
  where user_id = v_session.user_id;

  insert into public.xp_events (
    user_id, session_id, xp_awarded, leveled_up,
    level_before, level_after, streak_after, reason
  ) values (
    v_session.user_id, p_session_id, v_awarded, v_leveled_up,
    v_level_before, v_level_after, v_new_streak, v_reason
  );

  return jsonb_build_object(
    'skipped', false,
    'duplicate', false,
    'xpGained', v_awarded,
    'leveledUp', v_leveled_up,
    'levelBefore', v_level_before,
    'newLevel', v_level_after,
    'totalXp', v_total_after,
    'xpIntoLevel', v_xp_into,
    'xpToNext', v_xp_to_next,
    'streak', v_new_streak,
    'longestStreak', greatest(v_prog.longest_streak, v_new_streak),
    'title', public.level_title(v_level_after),
    'percentToNext', case
      when v_xp_to_next > 0 then round((v_xp_into::numeric / v_xp_to_next) * 1000) / 10
      else 0
    end,
    'reason', v_reason
  );
end;
$$;

create or replace function public.typing_sessions_award_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_session_xp(new.id);
  return new;
end;
$$;

drop trigger if exists typing_sessions_award_xp on public.typing_sessions;
create trigger typing_sessions_award_xp
  after insert on public.typing_sessions
  for each row
  execute function public.typing_sessions_award_xp();

-- Seed empty progression rows for existing profiles
insert into public.user_progression (user_id)
select p.user_id
from public.profiles p
on conflict (user_id) do nothing;

grant execute on function public.award_session_xp(uuid) to authenticated, anon;
grant execute on function public.xp_needed_for_level(integer) to authenticated, anon;
grant execute on function public.level_title(integer) to authenticated, anon;
grant execute on function public.compute_level_from_total_xp(integer) to authenticated, anon;
grant execute on function public.ensure_user_progression(text) to authenticated, anon;

-- Optional RPC for client to fetch award result after insert (idempotent)
create or replace function public.get_session_xp_award(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_event public.xp_events%rowtype;
  v_prog public.user_progression%rowtype;
  v_session_user text;
begin
  if p_session_id is null then
    return jsonb_build_object('skipped', true, 'reason', 'missing_session');
  end if;

  select user_id into v_session_user
  from public.typing_sessions
  where id = p_session_id;

  if v_session_user is null then
    return jsonb_build_object('skipped', true, 'reason', 'session_not_found');
  end if;

  if v_me is null or v_me <> v_session_user then
    return jsonb_build_object('skipped', true, 'reason', 'forbidden');
  end if;

  -- Ensure award ran (covers race / missed trigger)
  return public.award_session_xp(p_session_id);
end;
$$;

grant execute on function public.get_session_xp_award(uuid) to authenticated, anon;

create or replace function public.get_my_progression()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_row public.user_progression%rowtype;
  v_xp_to_next integer;
begin
  if v_me is null or trim(v_me) = '' then
    return jsonb_build_object('skipped', true, 'reason', 'not_signed_in');
  end if;

  v_row := public.ensure_user_progression(v_me);
  v_xp_to_next := public.xp_needed_for_level(v_row.level);

  return jsonb_build_object(
    'skipped', false,
    'user_id', v_row.user_id,
    'total_xp', v_row.total_xp,
    'level', v_row.level,
    'xp_into_level', v_row.xp_into_level,
    'xp_to_next', v_xp_to_next,
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'last_play_date', v_row.last_play_date,
    'daily_xp', v_row.daily_xp,
    'daily_xp_date', v_row.daily_xp_date,
    'updated_at', v_row.updated_at,
    'title', public.level_title(v_row.level),
    'percent_to_next', case
      when v_xp_to_next > 0 then round((v_row.xp_into_level::numeric / v_xp_to_next) * 1000) / 10
      else 0
    end
  );
end;
$$;

grant execute on function public.get_my_progression() to authenticated, anon;

-- Public level + XP ring data for avatars (strangers included).
-- Lean: no new storage; returns only user_id + level + xp_into_level (≤50 ids).
-- Client computes ring percent locally and caches for ~2 minutes.
drop function if exists public.get_public_progression_batch(text[]);

create or replace function public.get_public_progression_batch(p_user_ids text[])
returns table (
  user_id text,
  level integer,
  xp_into_level integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    up.user_id,
    up.level,
    up.xp_into_level
  from public.user_progression up
  where up.user_id = any (
    select distinct x
    from unnest(coalesce(p_user_ids, array[]::text[])) as u(x)
    where nullif(trim(x), '') is not null
    limit 50
  );
$$;

grant execute on function public.get_public_progression_batch(text[]) to authenticated, anon;

grant select on public.user_progression to authenticated;
grant select on public.xp_events to authenticated;

-- Backfill XP from historical non-failed sessions (oldest first) so veterans keep progress.
-- Uses the same award function / formula; soft-cap applies chronologically by UTC day.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.typing_sessions
    where failed = false
      and wpm > 0
      and id not in (select session_id from public.xp_events)
    order by created_at asc, id asc
  loop
    perform public.award_session_xp(r.id);
  end loop;
end;
$$;
