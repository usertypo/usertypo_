-- "New badge" notice: each badge is announced to its owner exactly once.
-- claim_my_new_badges() returns unannounced badges and marks them announced
-- in the same statement, so a second tab / device never shows them again.
-- Apply on staging then production.

alter table public.user_badges
  add column if not exists notified_at timestamptz;

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
  select coalesce(array_agg(c.badge order by
    case c.badge
      when 'discord_mod' then 1
      when 'contributor' then 2
      when 'tester' then 3
      when 'discord_first_100' then 4
      when 'first_100' then 5
      when 'first_1k' then 6
      else 9
    end
  ), array[]::text[])
  into v_badges
  from claimed c;

  return v_badges;
end;
$$;

revoke all on function public.claim_my_new_badges() from public, anon;
grant execute on function public.claim_my_new_badges() to authenticated;
