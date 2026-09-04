-- Drop Postgres notifications inbox (Cloudflare D1 owns friend notifications).
-- Apply to usertypo-dev first; production only after staging verification.
-- Safe only when the SPA uses USERTYPO_CONFIG.notifications.url (Worker).

-- 1) Friend RPCs: stop calling create_notification (client emits to CF Worker).
create or replace function public.send_friend_request(p_to_user_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_target text := trim(coalesce(p_to_user_id, ''));
  v_reverse_request_id uuid;
  v_request_id uuid;
  v_allow_requests boolean;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if v_target = '' then raise exception 'invalid_target'; end if;
  if v_target = v_me then raise exception 'cannot_friend_self'; end if;
  if not exists (select 1 from public.profiles p where p.user_id = v_target) then
    raise exception 'user_not_found';
  end if;
  if public._friendship_exists(v_me, v_target) then raise exception 'already_friends'; end if;
  if exists (
    select 1 from public.user_blocks ub
    where ub.blocker_id = v_target and ub.blocked_id = v_me
  ) then raise exception 'blocked_by_user'; end if;
  if exists (
    select 1 from public.user_blocks ub
    where ub.blocker_id = v_me and ub.blocked_id = v_target
  ) then raise exception 'you_blocked_user'; end if;

  select fr.id into v_reverse_request_id
  from public.friend_requests fr
  where fr.from_user_id = v_target
    and fr.to_user_id = v_me
    and fr.status = 'pending'
  limit 1;
  if v_reverse_request_id is not null then
    perform public.accept_friend_request(v_reverse_request_id);
    return v_reverse_request_id;
  end if;

  select coalesce(p.allow_friend_requests, true) into v_allow_requests
  from public.profiles p where p.user_id = v_target;
  if v_allow_requests is not true then raise exception 'friend_requests_disabled'; end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.from_user_id = v_me
      and fr.to_user_id = v_target
      and fr.status = 'pending'
  ) then raise exception 'request_already_sent'; end if;

  update public.friend_requests fr
  set status = 'pending', updated_at = now()
  where fr.from_user_id = v_me
    and fr.to_user_id = v_target
    and fr.status <> 'pending'
  returning fr.id into v_request_id;

  if v_request_id is null then
    insert into public.friend_requests (from_user_id, to_user_id, status)
    values (v_me, v_target, 'pending')
    on conflict (from_user_id, to_user_id) do update
      set status = 'pending', updated_at = now()
    returning id into v_request_id;
  end if;

  return v_request_id;
end;
$$;

create or replace function public.accept_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_from text;
  v_to text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select fr.from_user_id, fr.to_user_id
  into v_from, v_to
  from public.friend_requests fr
  where fr.id = p_request_id
    and fr.status = 'pending'
  for update;

  if not found then raise exception 'request_not_found'; end if;
  if v_to <> v_me then raise exception 'forbidden'; end if;
  if public._block_exists(v_from, v_to) then raise exception 'blocked_by_user'; end if;

  update public.friend_requests
  set status = 'accepted', updated_at = now()
  where id = p_request_id;

  insert into public.friendships (user_id, friend_id)
  values (v_from, v_to), (v_to, v_from)
  on conflict do nothing;
end;
$$;

-- 2) Account wipe: no longer touch public.notifications (inbox is D1).
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

  delete from public.typing_session_diagnostics d where d.user_id = v_me;
  delete from public.xp_events x where x.user_id = v_me;
  delete from public.typing_sessions ts where ts.user_id = v_me;
  get diagnostics v_sessions = row_count;

  delete from public.friend_requests fr
  where fr.from_user_id = v_me or fr.to_user_id = v_me;

  delete from public.friendships f
  where f.user_id = v_me or f.friend_id = v_me;

  delete from public.user_blocks ub
  where ub.blocker_id = v_me or ub.blocked_id = v_me;

  delete from public.user_progression up where up.user_id = v_me;

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

  return jsonb_build_object('ok', true, 'sessions_deleted', v_sessions);
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

  delete from public.typing_session_diagnostics d where d.user_id = v_me;
  delete from public.xp_events x where x.user_id = v_me;
  delete from public.typing_sessions ts where ts.user_id = v_me;
  get diagnostics v_sessions = row_count;

  delete from public.friend_requests fr
  where fr.from_user_id = v_me or fr.to_user_id = v_me;

  delete from public.friendships f
  where f.user_id = v_me or f.friend_id = v_me;

  delete from public.user_blocks ub
  where ub.blocker_id = v_me or ub.blocked_id = v_me;

  delete from public.user_progression up where up.user_id = v_me;

  delete from public.profiles p where p.user_id = v_me;

  return jsonb_build_object('ok', true, 'sessions_deleted', v_sessions);
end;
$$;

revoke all on function public.reset_my_account_data() from public, anon;
revoke all on function public.delete_my_account_data() from public, anon;
grant execute on function public.reset_my_account_data() to authenticated;
grant execute on function public.delete_my_account_data() to authenticated;

-- 3) Drop inbox RPCs, then the table (+ realtime publication).
drop function if exists public.get_my_notifications(integer);
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.get_unread_notification_count();
drop function if exists public.create_notification(text, text, text, text, jsonb);

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime drop table public.notifications;
  end if;
exception
  when undefined_object then null;
  when undefined_table then null;
end;
$$;

drop table if exists public.notifications;
