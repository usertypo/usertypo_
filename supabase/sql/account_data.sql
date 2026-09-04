-- Account data wipe helpers for System & Data settings.
-- reset_my_account_data: keep the profile/Clerk user, delete linked app data.
-- delete_my_account_data: delete profile + all linked app data (Clerk delete is client-side).
-- See also: phase8_account_privacy.sql (live hardening).

create or replace function public.reset_my_account_data()
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

  delete from public.friend_requests fr
  where fr.from_user_id = v_me
     or fr.to_user_id = v_me;

  delete from public.friendships f
  where f.user_id = v_me
     or f.friend_id = v_me;

  delete from public.user_blocks ub
  where ub.blocker_id = v_me
     or ub.blocked_id = v_me;

  -- Friend inbox lives on Cloudflare D1 (cleared client-side via notifications Worker).

  delete from public.user_progression up
  where up.user_id = v_me;

  insert into public.user_progression (user_id)
  values (v_me)
  on conflict (user_id) do update
    set total_xp = 0,
        level = 1,
        xp_into_level = 0,
        current_streak = 0,
        longest_streak = 0,
        last_play_date = null,
        daily_xp = 0,
        daily_xp_date = null,
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'sessions_deleted', v_sessions
  );
end;
$$;

create or replace function public.delete_my_account_data()
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

  -- Wipe user-owned rows explicitly (typing_sessions has no FK to profiles).
  delete from public.typing_session_diagnostics d
  where d.user_id = v_me;

  delete from public.xp_events x
  where x.user_id = v_me;

  delete from public.typing_sessions ts
  where ts.user_id = v_me;
  get diagnostics v_sessions = row_count;

  delete from public.friend_requests fr
  where fr.from_user_id = v_me
     or fr.to_user_id = v_me;

  delete from public.friendships f
  where f.user_id = v_me
     or f.friend_id = v_me;

  delete from public.user_blocks ub
  where ub.blocker_id = v_me
     or ub.blocked_id = v_me;

  -- Friend inbox lives on Cloudflare D1 (cleared client-side via notifications Worker).

  delete from public.user_progression up
  where up.user_id = v_me;

  -- Profile delete also cascades remaining FKs if any remain.
  delete from public.profiles p
  where p.user_id = v_me;

  return jsonb_build_object(
    'ok', true,
    'sessions_deleted', v_sessions
  );
end;
$$;

revoke all on function public.reset_my_account_data() from public, anon;
revoke all on function public.delete_my_account_data() from public, anon;
grant execute on function public.reset_my_account_data() to authenticated;
grant execute on function public.delete_my_account_data() to authenticated;
