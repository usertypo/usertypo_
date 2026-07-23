-- Notifications + online presence for friends

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  type text not null check (type in ('friend_request', 'friend_accepted')),
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Users can view their notifications" on public.notifications;
create policy "Users can view their notifications"
  on public.notifications for select
  using (user_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications"
  on public.notifications for update
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Users can delete their notifications" on public.notifications;
create policy "Users can delete their notifications"
  on public.notifications for delete
  using (user_id = (select auth.jwt() ->> 'sub'));

-- Realtime: allow clients to receive INSERT/UPDATE for their rows
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

create or replace function public.create_notification(
  p_user_id text,
  p_type text,
  p_title text,
  p_body text default null,
  p_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or trim(p_user_id) = '' then
    raise exception 'invalid_user';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (p_user_id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.profile_display_label(p_user_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.username), ''), nullif(trim(p.display_name), ''), p.user_id)
  from public.profiles p
  where p.user_id = p_user_id
  limit 1;
$$;

create or replace function public.heartbeat()
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
  set last_seen_at = now(), updated_at = now()
  where user_id = v_me;
end;
$$;

create or replace function public.get_my_notifications(p_limit integer default 50)
returns table (
  id uuid,
  type text,
  title text,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_me is null then
    return;
  end if;

  return query
  select
    n.id,
    n.type,
    n.title,
    n.body,
    n.data,
    n.read_at,
    n.created_at
  from public.notifications n
  where n.user_id = v_me
    and n.created_at >= now() - interval '1 day'
  order by n.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_count integer := 0;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_ids is null then
    update public.notifications n
    set read_at = now()
    where n.user_id = v_me
      and n.read_at is null;
  else
    update public.notifications n
    set read_at = now()
    where n.user_id = v_me
      and n.read_at is null
      and n.id = any(p_ids);
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_unread_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
begin
  if v_me is null then
    return 0;
  end if;

  return (
    select count(*)::integer
    from public.notifications n
    where n.user_id = v_me
      and n.read_at is null
  );
end;
$$;

-- Patch friend request RPCs to emit notifications + include online in dashboard

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
  v_my_label text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_target = '' then
    raise exception 'invalid_target';
  end if;

  if v_target = v_me then
    raise exception 'cannot_friend_self';
  end if;

  if not exists (select 1 from public.profiles p where p.user_id = v_target) then
    raise exception 'user_not_found';
  end if;

  if public._friendship_exists(v_me, v_target) then
    raise exception 'already_friends';
  end if;

  select fr.id
  into v_reverse_request_id
  from public.friend_requests fr
  where fr.from_user_id = v_target
    and fr.to_user_id = v_me
    and fr.status = 'pending'
  limit 1;

  if v_reverse_request_id is not null then
    perform public.accept_friend_request(v_reverse_request_id);
    return v_reverse_request_id;
  end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.from_user_id = v_me
      and fr.to_user_id = v_target
      and fr.status = 'pending'
  ) then
    raise exception 'request_already_sent';
  end if;

  -- Reactivate any prior non-pending row (declined / cancelled / accepted-after-unfriend)
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

  v_my_label := public.profile_display_label(v_me);
  perform public.create_notification(
    v_target,
    'friend_request',
    v_my_label || ' sent you a friend request',
    'Accept or decline below.',
    jsonb_build_object(
      'request_id', v_request_id,
      'from_user_id', v_me,
      'from_username', v_my_label
    )
  );

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
  v_my_label text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select fr.from_user_id, fr.to_user_id
  into v_from, v_to
  from public.friend_requests fr
  where fr.id = p_request_id
    and fr.status = 'pending'
  for update;

  if not found then
    raise exception 'request_not_found';
  end if;

  if v_to <> v_me then
    raise exception 'forbidden';
  end if;

  update public.friend_requests
  set status = 'accepted', updated_at = now()
  where id = p_request_id;

  insert into public.friendships (user_id, friend_id)
  values (v_from, v_to), (v_to, v_from)
  on conflict do nothing;

  v_my_label := public.profile_display_label(v_me);
  perform public.create_notification(
    v_from,
    'friend_accepted',
    v_my_label || ' accepted your friend request',
    'You are now friends.',
    jsonb_build_object(
      'request_id', p_request_id,
      'friend_user_id', v_me,
      'friend_username', v_my_label
    )
  );
end;
$$;

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
  v_online_cutoff timestamptz := now() - interval '2 minutes';
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
      p.username,
      p.display_name,
      p.avatar_url,
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
      p.username,
      p.display_name,
      p.avatar_url,
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
      p.username,
      p.display_name,
      p.avatar_url,
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

grant execute on function public.create_notification(text, text, text, text, jsonb) to authenticated;
grant execute on function public.heartbeat() to authenticated;
grant execute on function public.get_my_notifications(integer) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.get_friends_dashboard() to authenticated;
