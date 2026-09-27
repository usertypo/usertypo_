-- Profile badges: Owner (manual) for usertypo_, S_A_, L_J.
-- Also gives yes_no Tester and First 100 Discord.
-- Apply on staging then production (after 20260928_badge_award_notice.sql).

alter table public.user_badges
  drop constraint if exists user_badges_badge_check;
alter table public.user_badges
  add constraint user_badges_badge_check
  check (badge in (
    'owner', 'first_100', 'first_1k', 'discord_mod', 'contributor',
    'tester', 'discord_first_100'
  ));

create or replace function public._badge_rank(p_badge text)
returns integer
language sql
immutable
as $$
  select case p_badge
    when 'owner' then 0
    when 'discord_mod' then 1
    when 'contributor' then 2
    when 'tester' then 3
    when 'discord_first_100' then 4
    when 'first_100' then 5
    when 'first_1k' then 6
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

insert into public.user_badges (user_id, badge, source)
select p.user_id, 'owner', 'manual'
from public.profiles p
where lower(p.username) in ('usertypo_', 's_a_', 'l_j')
on conflict (user_id, badge) do nothing;

insert into public.user_badges (user_id, badge, source)
select p.user_id, b.badge, 'manual'
from public.profiles p
cross join (values ('tester'), ('discord_first_100')) as b(badge)
where lower(p.username) = 'yes_no'
on conflict (user_id, badge) do nothing;
