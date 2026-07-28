-- Phase 4 security hardening (feature-preserving)
-- Applied carefully after auditing js/api/* call sites.
--
-- Keeps working:
--   - session insert + XP trigger + get_session_xp_award / get_my_progression
--   - friends / blocks / notifications RPCs (authenticated)
--   - public leaderboard + public profile card (anon + authenticated)
--   - ensure_user_progression fallback (authenticated, own user only)
--
-- Blocks:
--   - client UPDATE of typing_sessions (score tampering)
--   - absurd WPM / accuracy values on insert
--   - public RPC access to create_notification / award_session_xp / triggers
--   - TRUNCATE / TRIGGER / REFERENCES grants on public tables

-- ---------------------------------------------------------------------------
-- 1) typing_sessions: remove client UPDATE (app only inserts + selects)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can update their own typing sessions" on public.typing_sessions;
revoke update on table public.typing_sessions from authenticated;
revoke update on table public.typing_sessions from anon;

-- Generous limits (multiplayer caps ~220–280; elite humans << 500)
alter table public.typing_sessions
  drop constraint if exists typing_sessions_wpm_range;
alter table public.typing_sessions
  drop constraint if exists typing_sessions_raw_wpm_range;
alter table public.typing_sessions
  drop constraint if exists typing_sessions_accuracy_range;
alter table public.typing_sessions
  drop constraint if exists typing_sessions_consistency_range;
alter table public.typing_sessions
  drop constraint if exists typing_sessions_duration_range;
alter table public.typing_sessions
  drop constraint if exists typing_sessions_errors_range;
alter table public.typing_sessions
  drop constraint if exists typing_sessions_chars_range;

alter table public.typing_sessions
  add constraint typing_sessions_wpm_range
    check (wpm is null or (wpm >= 0 and wpm <= 500));

alter table public.typing_sessions
  add constraint typing_sessions_raw_wpm_range
    check (raw_wpm is null or (raw_wpm >= 0 and raw_wpm <= 500));

alter table public.typing_sessions
  add constraint typing_sessions_accuracy_range
    check (accuracy is null or (accuracy >= 0 and accuracy <= 100));

alter table public.typing_sessions
  add constraint typing_sessions_consistency_range
    check (consistency is null or (consistency >= 0 and consistency <= 100));

alter table public.typing_sessions
  add constraint typing_sessions_duration_range
    check (duration_seconds is null or (duration_seconds >= 0 and duration_seconds <= 7200));

alter table public.typing_sessions
  add constraint typing_sessions_errors_range
    check (errors is null or errors >= 0);

alter table public.typing_sessions
  add constraint typing_sessions_chars_range
    check (
      (correct_chars is null or correct_chars >= 0)
      and (total_chars is null or total_chars >= 0)
    );

-- ---------------------------------------------------------------------------
-- 2) Harden table grants: drop TRUNCATE / TRIGGER / REFERENCES
--    (PostgREST does not use these; they are unnecessary attack surface)
-- ---------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------
-- 3) ensure_user_progression: only own user_id (or service_role)
--    Still callable by authenticated (client fallback) and by get_my_progression.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_user_progression(p_user_id text)
returns public.user_progression
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_progression;
  v_me text := nullif(trim(coalesce(auth.jwt() ->> 'sub', '')), '');
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if p_user_id is null or trim(p_user_id) = '' then
    raise exception 'invalid_user';
  end if;

  -- Allow:
  --   1) calls from table triggers (session insert → XP award path)
  --   2) service_role (Render / Edge Functions)
  --   3) signed-in user matching p_user_id (client / get_my_progression)
  if pg_trigger_depth() = 0
     and v_role is distinct from 'service_role'
     and (v_me is null or v_me is distinct from p_user_id) then
    raise exception 'not_authorized';
  end if;

  insert into public.user_progression (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_row
  from public.user_progression
  where user_id = p_user_id;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Revoke PUBLIC/anon/authenticated from internal + dangerous RPCs,
--    then re-grant only intentional client entry points.
-- ---------------------------------------------------------------------------

-- Internal / trigger helpers — must NOT be callable via /rest/v1/rpc
revoke all on function public.create_notification(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.award_session_xp(uuid) from public, anon, authenticated;
revoke all on function public.set_typing_session_is_pb() from public, anon, authenticated;
revoke all on function public.typing_sessions_award_xp() from public, anon, authenticated;
revoke all on function public.trim_typing_session_diagnostics() from public, anon, authenticated;
revoke all on function public.profiles_assign_public_id() from public, anon, authenticated;
revoke all on function public.generate_public_id() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public._friendship_exists(text, text) from public, anon, authenticated;
revoke all on function public._relationship_with_user(text) from public, anon, authenticated;

-- Helper math (safe to keep public for client display fallbacks)
revoke all on function public.apply_daily_xp_soft_cap(integer, integer) from public, anon, authenticated;
revoke all on function public.streak_xp_multiplier(integer) from public, anon, authenticated;

-- Optional: set_profiles_updated_at / friend_requests_set_updated_at are triggers
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_profiles_updated_at'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    execute 'revoke all on function public.set_profiles_updated_at() from public, anon, authenticated';
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'friend_requests_set_updated_at'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    execute 'revoke all on function public.friend_requests_set_updated_at() from public, anon, authenticated';
  end if;
end $$;

-- Strip default PUBLIC execute from signed-in-only RPCs, then grant precisely.
revoke all on function public.ensure_user_progression(text) from public, anon, authenticated;
revoke all on function public.get_my_progression() from public, anon, authenticated;
revoke all on function public.get_session_xp_award(uuid) from public, anon, authenticated;
revoke all on function public.get_my_leaderboard_rank(text, integer, text) from public, anon, authenticated;
revoke all on function public.search_profiles(text, integer) from public, anon, authenticated;
revoke all on function public.send_friend_request(text) from public, anon, authenticated;
revoke all on function public.accept_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.decline_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.cancel_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.remove_friend(text) from public, anon, authenticated;
revoke all on function public.get_friends_dashboard() from public, anon, authenticated;
revoke all on function public.block_user(text) from public, anon, authenticated;
revoke all on function public.unblock_user(text) from public, anon, authenticated;
revoke all on function public.get_my_blocked_users() from public, anon, authenticated;
revoke all on function public.ids_who_blocked_me(text[]) from public, anon, authenticated;
revoke all on function public.heartbeat() from public, anon, authenticated;
revoke all on function public.get_my_notifications(integer) from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon, authenticated;
revoke all on function public.get_unread_notification_count() from public, anon, authenticated;
revoke all on function public.reset_my_account_data() from public, anon, authenticated;
revoke all on function public.delete_my_account_data() from public, anon, authenticated;

-- Public / guest-safe reads:
revoke all on function public.get_leaderboard(text, integer, text, integer) from public;
revoke all on function public.get_public_profile_card(text) from public;
revoke all on function public.get_public_progression_batch(text[]) from public;
revoke all on function public.xp_needed_for_level(integer) from public;
revoke all on function public.level_title(integer) from public;
revoke all on function public.compute_level_from_total_xp(integer) from public;
revoke all on function public.profile_display_label(text) from public;

grant execute on function public.get_leaderboard(text, integer, text, integer) to anon, authenticated;
grant execute on function public.get_public_profile_card(text) to anon, authenticated;
grant execute on function public.get_public_progression_batch(text[]) to anon, authenticated;
grant execute on function public.xp_needed_for_level(integer) to anon, authenticated;
grant execute on function public.level_title(integer) to anon, authenticated;
grant execute on function public.compute_level_from_total_xp(integer) to anon, authenticated;
grant execute on function public.profile_display_label(text) to anon, authenticated;

-- Signed-in features (match js/api/* usage):
grant execute on function public.ensure_user_progression(text) to authenticated;
grant execute on function public.get_my_progression() to authenticated;
grant execute on function public.get_session_xp_award(uuid) to authenticated;
grant execute on function public.get_my_leaderboard_rank(text, integer, text) to authenticated;
grant execute on function public.search_profiles(text, integer) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(text) to authenticated;
grant execute on function public.get_friends_dashboard() to authenticated;
grant execute on function public.block_user(text) to authenticated;
grant execute on function public.unblock_user(text) to authenticated;
grant execute on function public.get_my_blocked_users() to authenticated;
grant execute on function public.ids_who_blocked_me(text[]) to authenticated;
grant execute on function public.heartbeat() to authenticated;
grant execute on function public.get_my_notifications(integer) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.reset_my_account_data() to authenticated;
grant execute on function public.delete_my_account_data() to authenticated;

-- service_role keeps full access for Render multiplayer / Edge Functions
grant execute on function public.create_notification(text, text, text, text, jsonb) to service_role;
grant execute on function public.award_session_xp(uuid) to service_role;
grant execute on function public.ensure_user_progression(text) to service_role;
