-- List users I have blocked (for Account Settings → Blocked Users).
create or replace function public.get_my_blocked_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_rows jsonb;
begin
  if v_me is null or trim(v_me) = '' then
    raise exception 'not_authenticated';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'blocked_at', ub.created_at
  ) order by ub.created_at desc), '[]'::jsonb)
  into v_rows
  from public.user_blocks ub
  inner join public.profiles p on p.user_id = ub.blocked_id
  where ub.blocker_id = v_me;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

grant execute on function public.get_my_blocked_users() to authenticated;
