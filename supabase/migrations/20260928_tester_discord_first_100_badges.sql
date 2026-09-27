-- Profile badges: Tester and First 100 Discord (both manual).
-- Apply on staging then production.

alter table public.user_badges
  drop constraint if exists user_badges_badge_check;
alter table public.user_badges
  add constraint user_badges_badge_check
  check (badge in (
    'first_100', 'first_1k', 'discord_mod', 'contributor',
    'tester', 'discord_first_100'
  ));

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
        when 'tester' then 3
        when 'discord_first_100' then 4
        when 'first_100' then 5
        when 'first_1k' then 6
        else 9
      end
    ) as badges
  from public.user_badges ub
  where ub.user_id = any(coalesce(p_ids, array[]::text[]))
  group by ub.user_id;
$$;

revoke all on function public.get_profile_badges(text[]) from public;
grant execute on function public.get_profile_badges(text[]) to anon, authenticated;

insert into public.user_badges (user_id, badge, source)
select p.user_id, b.badge, 'manual'
from public.profiles p
cross join (values ('tester'), ('discord_first_100')) as b(badge)
where lower(p.username) = 'braindeadghj4'
on conflict (user_id, badge) do nothing;
