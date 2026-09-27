-- Profile badges: Builder (manual), plus revocable badges.
-- revoked_at hides a badge without deleting it, so a revoked auto First 100 /
-- First 1K row still holds its signup slot for _grant_signup_badge().
-- Assignments: usertypo_ gets every badge; S_A_ and L_J keep only Owner +
-- Builder; yes_no loses First 100 Discord.
-- Apply on staging then production (after 20260928_owner_badge.sql).

alter table public.user_badges
  drop constraint if exists user_badges_badge_check;
alter table public.user_badges
  add constraint user_badges_badge_check
  check (badge in (
    'owner', 'builder', 'first_100', 'first_1k', 'discord_mod', 'contributor',
    'tester', 'discord_first_100'
  ));

alter table public.user_badges
  add column if not exists revoked_at timestamptz;

create or replace function public._badge_rank(p_badge text)
returns integer
language sql
immutable
as $$
  select case p_badge
    when 'owner' then 0
    when 'builder' then 1
    when 'discord_mod' then 2
    when 'contributor' then 3
    when 'tester' then 4
    when 'discord_first_100' then 5
    when 'first_100' then 6
    when 'first_1k' then 7
    else 9
  end;
$$;

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
    array_agg(ub.badge order by public._badge_rank(ub.badge)) as badges
  from public.user_badges ub
  where ub.user_id = any(coalesce(p_ids, array[]::text[]))
    and ub.revoked_at is null
  group by ub.user_id;
$$;

revoke all on function public.get_profile_badges(text[]) from public;
grant execute on function public.get_profile_badges(text[]) to anon, authenticated;

create or replace function public.claim_my_new_badges()
returns text[]
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_badges text[];
begin
  if v_me is null or trim(v_me) = '' or v_me like 'guest_%' then
    return array[]::text[];
  end if;

  with claimed as (
    update public.user_badges ub
    set notified_at = now()
    where ub.user_id = v_me
      and ub.notified_at is null
      and ub.revoked_at is null
    returning ub.badge
  )
  select coalesce(array_agg(c.badge order by public._badge_rank(c.badge)), array[]::text[])
  into v_badges
  from claimed c;

  return v_badges;
end;
$$;

revoke all on function public.claim_my_new_badges() from public, anon;
grant execute on function public.claim_my_new_badges() to authenticated;

-- usertypo_: every badge.
insert into public.user_badges (user_id, badge, source)
select p.user_id, b.badge, 'manual'
from public.profiles p
cross join (values
  ('owner'), ('builder'), ('discord_mod'), ('contributor'),
  ('tester'), ('discord_first_100'), ('first_100'), ('first_1k')
) as b(badge)
where lower(p.username) = 'usertypo_'
on conflict (user_id, badge) do update set revoked_at = null;

-- S_A_ and L_J: Owner + Builder only.
insert into public.user_badges (user_id, badge, source)
select p.user_id, b.badge, 'manual'
from public.profiles p
cross join (values ('owner'), ('builder')) as b(badge)
where lower(p.username) in ('s_a_', 'l_j')
on conflict (user_id, badge) do update set revoked_at = null;

update public.user_badges ub
set revoked_at = now()
from public.profiles p
where p.user_id = ub.user_id
  and lower(p.username) in ('s_a_', 'l_j')
  and ub.source = 'auto'
  and ub.badge not in ('owner', 'builder')
  and ub.revoked_at is null;

delete from public.user_badges ub
using public.profiles p
where p.user_id = ub.user_id
  and lower(p.username) in ('s_a_', 'l_j')
  and ub.source = 'manual'
  and ub.badge not in ('owner', 'builder');

-- yes_no: no First 100 Discord.
delete from public.user_badges ub
using public.profiles p
where p.user_id = ub.user_id
  and lower(p.username) = 'yes_no'
  and ub.badge = 'discord_first_100';
