-- Profile badges: First 100 / First 1K (auto, by signup order), Discord Mod and
-- Contributor (manual). Read via get_profile_badges(); no direct client access.
-- Apply on staging then production.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
-- No FK to profiles: a deleted account keeps its early-signup slot so later
-- signups never inherit First 100 / First 1K.
create table if not exists public.user_badges (
  user_id text not null,
  badge text not null
    check (badge in ('first_100', 'first_1k', 'discord_mod', 'contributor')),
  source text not null default 'manual'
    check (source in ('auto', 'manual')),
  granted_at timestamptz not null default now(),
  primary key (user_id, badge)
);

create index if not exists user_badges_auto_idx
  on public.user_badges (badge)
  where source = 'auto';

alter table public.user_badges enable row level security;

drop policy if exists user_badges_no_direct on public.user_badges;
create policy user_badges_no_direct on public.user_badges
  for all
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- Backfill signup badges (one tier per user: First 100 supersedes First 1K)
-- ---------------------------------------------------------------------------
insert into public.user_badges (user_id, badge, source, granted_at)
select
  ranked.user_id,
  case when ranked.signup_rank <= 100 then 'first_100' else 'first_1k' end,
  'auto',
  now()
from (
  select
    p.user_id,
    row_number() over (order by p.created_at asc, p.user_id asc) as signup_rank
  from public.profiles p
  where p.user_id is not null
    and p.user_id not like 'guest_%'
) ranked
where ranked.signup_rank <= 1000
  and not exists (
    select 1 from public.user_badges ub
    where ub.user_id = ranked.user_id
      and ub.source = 'auto'
  )
on conflict (user_id, badge) do nothing;

-- ---------------------------------------------------------------------------
-- Grant signup badges to new profiles
-- ---------------------------------------------------------------------------
create or replace function public._grant_signup_badge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken integer;
begin
  if new.user_id is null or new.user_id like 'guest_%' then
    return new;
  end if;

  -- Serialize concurrent signups so slot counts stay exact.
  perform pg_advisory_xact_lock(hashtext('usertypo_signup_badges'));

  if exists (
    select 1 from public.user_badges ub
    where ub.user_id = new.user_id and ub.source = 'auto'
  ) then
    return new;
  end if;

  select count(*) into v_taken
  from public.user_badges ub
  where ub.source = 'auto'
    and ub.badge in ('first_100', 'first_1k');

  if v_taken < 100 then
    insert into public.user_badges (user_id, badge, source)
    values (new.user_id, 'first_100', 'auto')
    on conflict (user_id, badge) do nothing;
  elsif v_taken < 1000 then
    insert into public.user_badges (user_id, badge, source)
    values (new.user_id, 'first_1k', 'auto')
    on conflict (user_id, badge) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public._grant_signup_badge() from public;

drop trigger if exists profiles_grant_signup_badge on public.profiles;
create trigger profiles_grant_signup_badge
  after insert on public.profiles
  for each row
  execute function public._grant_signup_badge();

-- ---------------------------------------------------------------------------
-- Manual badges
-- ---------------------------------------------------------------------------
insert into public.user_badges (user_id, badge, source)
select p.user_id, 'contributor', 'manual'
from public.profiles p
where lower(p.username) in ('usertypo_', 's_a_', 'l_j')
on conflict (user_id, badge) do nothing;

insert into public.user_badges (user_id, badge, source)
select p.user_id, 'discord_mod', 'manual'
from public.profiles p
where lower(p.username) = 'yes_no'
on conflict (user_id, badge) do nothing;

-- ---------------------------------------------------------------------------
-- Read RPC
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_badges(p_ids text[])
returns table (
  user_id text,
  badges text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ub.user_id,
    array_agg(ub.badge order by
      case ub.badge
        when 'discord_mod' then 1
        when 'contributor' then 2
        when 'first_100' then 3
        when 'first_1k' then 4
        else 9
      end
    ) as badges
  from public.user_badges ub
  where ub.user_id = any(coalesce(p_ids, array[]::text[]))
  group by ub.user_id;
$$;

revoke all on function public.get_profile_badges(text[]) from public;
grant execute on function public.get_profile_badges(text[]) to anon, authenticated;
