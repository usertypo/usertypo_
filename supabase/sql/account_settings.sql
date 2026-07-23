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

-- Clear personal bests / test history scores without wiping friends or account.
create or replace function public.reset_my_personal_bests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_sessions integer := 0;
begin
  if v_me is null or trim(v_me) = '' then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1 from public.profiles p where p.user_id = v_me) then
    raise exception 'user_not_found';
  end if;

  delete from public.typing_session_diagnostics d
  where d.user_id = v_me;

  delete from public.xp_events x
  where x.user_id = v_me;

  delete from public.typing_sessions ts
  where ts.user_id = v_me;
  get diagnostics v_sessions = row_count;

  return jsonb_build_object(
    'ok', true,
    'sessions_deleted', v_sessions
  );
end;
$$;

grant execute on function public.get_my_blocked_users() to authenticated;
grant execute on function public.reset_my_personal_bests() to authenticated;
