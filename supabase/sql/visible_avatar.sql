-- Hide real avatars from users who are blocked by the profile owner.
-- Also used by Redis leaderboard client strip (ids_who_blocked_me).

create or replace function public._visible_avatar_url(p_owner text, p_url text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_url is null or btrim(p_url) = '' then null
    when exists (
      select 1 from public.user_blocks ub
      where ub.blocker_id = p_owner
        and ub.blocked_id = (auth.jwt() ->> 'sub')
    ) then null
    else p_url
  end;
$$;

revoke all on function public._visible_avatar_url(text, text) from public;

create or replace function public.ids_who_blocked_me(p_ids text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(ub.blocker_id), '{}'::text[])
  from public.user_blocks ub
  where ub.blocked_id = (auth.jwt() ->> 'sub')
    and ub.blocker_id = any (coalesce(p_ids, '{}'::text[]));
$$;

revoke all on function public.ids_who_blocked_me(text[]) from public;
grant execute on function public.ids_who_blocked_me(text[]) to authenticated;
