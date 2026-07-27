-- One lean RPC for the mid-page player profile box.
-- Enforces profiles.profile_visibility (public | friends | private).
create or replace function public.get_public_profile_card(p_user_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_target text := trim(coalesce(p_user_id, ''));
  v_profile public.profiles%rowtype;
  v_prog public.user_progression%rowtype;
  v_summary jsonb;
  v_bests jsonb;
  v_xp_to_next integer;
  v_visibility text;
begin
  if v_me is null or trim(v_me) = '' then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  if v_target = '' or v_target like 'guest_%' then
    return jsonb_build_object('error', 'invalid_user');
  end if;

  select * into v_profile
  from public.profiles p
  where p.user_id = v_target;

  if not found then
    return jsonb_build_object('error', 'user_not_found');
  end if;

  -- Own profile is always visible.
  if v_profile.user_id <> v_me then
    -- Target blocked the viewer → hide profile.
    if exists (
      select 1 from public.user_blocks ub
      where ub.blocker_id = v_profile.user_id
        and ub.blocked_id = v_me
    ) then
      return jsonb_build_object('error', 'blocked_by_user');
    end if;

    v_visibility := coalesce(nullif(trim(v_profile.profile_visibility), ''), 'public');

    if v_visibility = 'private' then
      return jsonb_build_object('error', 'profile_not_allowed');
    end if;

    if v_visibility = 'friends' and not public._friendship_exists(v_me, v_profile.user_id) then
      return jsonb_build_object('error', 'profile_not_allowed');
    end if;
  end if;

  select * into v_prog
  from public.user_progression up
  where up.user_id = v_target;

  v_xp_to_next := public.xp_needed_for_level(coalesce(v_prog.level, 1));

  select jsonb_build_object(
    'tests', count(*)::integer,
    'total_seconds', coalesce(sum(greatest(ts.duration_seconds, 0)), 0)::integer,
    'total_words', coalesce(sum(greatest(ts.correct_chars, 0) / 5), 0)::integer
  )
  into v_summary
  from public.typing_sessions ts
  where ts.user_id = v_target;

  select coalesce(jsonb_agg(jsonb_build_object(
    'mode', b.mode,
    'amount', b.amount,
    'wpm', b.wpm,
    'accuracy', b.accuracy
  ) order by b.mode, b.amount), '[]'::jsonb)
  into v_bests
  from (
    select distinct on (ts.mode, ts.amount)
      ts.mode,
      ts.amount,
      ts.wpm,
      ts.accuracy
    from public.typing_sessions ts
    where ts.user_id = v_target
      and ts.failed = false
      and (
        (ts.mode = 'time' and ts.amount in (15, 30, 60, 120))
        or (ts.mode = 'words' and ts.amount in (10, 25, 50, 100))
      )
    order by ts.mode, ts.amount, ts.wpm desc, ts.accuracy desc nulls last
  ) b;

  return jsonb_build_object(
    'user_id', v_profile.user_id,
    'public_id', v_profile.public_id,
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'avatar_url', v_profile.avatar_url,
    'is_self', (v_profile.user_id = v_me),
    'relationship', case
      when v_profile.user_id = v_me then 'self'
      else public._relationship_with_user(v_profile.user_id)
    end,
    'i_blocked', exists (
      select 1 from public.user_blocks ub
      where ub.blocker_id = v_me and ub.blocked_id = v_profile.user_id
    ),
    'level', coalesce(v_prog.level, 1),
    'xp_into_level', coalesce(v_prog.xp_into_level, 0),
    'xp_to_next', v_xp_to_next,
    'current_streak', coalesce(v_prog.current_streak, 0),
    'title', public.level_title(coalesce(v_prog.level, 1)),
    'summary', coalesce(v_summary, jsonb_build_object('tests', 0, 'total_seconds', 0, 'total_words', 0)),
    'bests', coalesce(v_bests, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_public_profile_card(text) to authenticated;
