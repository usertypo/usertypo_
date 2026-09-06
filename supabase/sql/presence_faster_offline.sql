-- Faster friend presence: shorter online window + explicit offline on leave.
create or replace function public.go_offline()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  update public.profiles
  set last_seen_at = null, updated_at = now()
  where user_id = v_me;
end;
$$;

revoke all on function public.go_offline() from public, anon;
grant execute on function public.go_offline() to authenticated;

create or replace function public.get_friends_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_friends jsonb := '[]'::jsonb;
  v_incoming jsonb := '[]'::jsonb;
  v_outgoing jsonb := '[]'::jsonb;
  -- Heartbeat ~15s; treat offline after ~45s without a beat (or after go_offline).
  v_online_cutoff timestamptz := now() - interval '45 seconds';
begin
  if v_me is null then
    return jsonb_build_object(
      'friends', '[]'::jsonb,
      'incoming', '[]'::jsonb,
      'outgoing', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.friends_since desc), '[]'::jsonb)
  into v_friends
  from (
    select
      p.user_id,
      p.public_id,
      p.username,
      p.display_name,
      public._visible_avatar_url(p.user_id, p.avatar_url) as avatar_url,
      f.created_at as friends_since,
      (p.last_seen_at is not null and p.last_seen_at >= v_online_cutoff) as is_online,
      p.last_seen_at,
      coalesce(up.level, 1) as level,
      case
        when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
          then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
        else 0
      end as percent_to_next
    from public.friendships f
    inner join public.profiles p on p.user_id = f.friend_id
    left join public.user_progression up on up.user_id = p.user_id
    where f.user_id = v_me
    order by f.created_at desc
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
  into v_incoming
  from (
    select
      fr.id as request_id,
      fr.created_at,
      p.user_id,
      p.public_id,
      p.username,
      p.display_name,
      public._visible_avatar_url(p.user_id, p.avatar_url) as avatar_url,
      coalesce(up.level, 1) as level,
      case
        when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
          then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
        else 0
      end as percent_to_next
    from public.friend_requests fr
    inner join public.profiles p on p.user_id = fr.from_user_id
    left join public.user_progression up on up.user_id = p.user_id
    where fr.to_user_id = v_me
      and fr.status = 'pending'
    order by fr.created_at desc
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
  into v_outgoing
  from (
    select
      fr.id as request_id,
      fr.created_at,
      p.user_id,
      p.public_id,
      p.username,
      p.display_name,
      public._visible_avatar_url(p.user_id, p.avatar_url) as avatar_url,
      coalesce(up.level, 1) as level,
      case
        when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
          then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
        else 0
      end as percent_to_next
    from public.friend_requests fr
    inner join public.profiles p on p.user_id = fr.to_user_id
    left join public.user_progression up on up.user_id = p.user_id
    where fr.from_user_id = v_me
      and fr.status = 'pending'
    order by fr.created_at desc
  ) t;

  return jsonb_build_object(
    'friends', v_friends,
    'incoming', v_incoming,
    'outgoing', v_outgoing
  );
end;
$$;
