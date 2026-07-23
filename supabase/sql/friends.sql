-- Friends: friend requests + bidirectional friendships
-- Search and dashboard use security definer RPCs because profiles are private via RLS.

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id text not null references public.profiles(user_id) on delete cascade,
  to_user_id text not null references public.profiles(user_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_no_self check (from_user_id <> to_user_id),
  constraint friend_requests_unique_pair unique (from_user_id, to_user_id)
);

create table if not exists public.friendships (
  user_id text not null references public.profiles(user_id) on delete cascade,
  friend_id text not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendships_no_self check (user_id <> friend_id)
);

create index if not exists friendships_friend_id_idx on public.friendships (friend_id);
create index if not exists friend_requests_to_pending_idx
  on public.friend_requests (to_user_id)
  where status = 'pending';
create index if not exists friend_requests_from_pending_idx
  on public.friend_requests (from_user_id)
  where status = 'pending';

create or replace function public.friend_requests_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists friend_requests_set_updated_at on public.friend_requests;
create trigger friend_requests_set_updated_at
  before update on public.friend_requests
  for each row execute function public.friend_requests_set_updated_at();

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

drop policy if exists "Users can view their friend requests" on public.friend_requests;
create policy "Users can view their friend requests"
  on public.friend_requests for select
  using (
    from_user_id = (select auth.jwt() ->> 'sub')
    or to_user_id = (select auth.jwt() ->> 'sub')
  );

drop policy if exists "Users can insert outgoing friend requests" on public.friend_requests;
create policy "Users can insert outgoing friend requests"
  on public.friend_requests for insert
  with check (from_user_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Users can update their friend requests" on public.friend_requests;
create policy "Users can update their friend requests"
  on public.friend_requests for update
  using (
    from_user_id = (select auth.jwt() ->> 'sub')
    or to_user_id = (select auth.jwt() ->> 'sub')
  )
  with check (
    from_user_id = (select auth.jwt() ->> 'sub')
    or to_user_id = (select auth.jwt() ->> 'sub')
  );

drop policy if exists "Users can view their friendships" on public.friendships;
create policy "Users can view their friendships"
  on public.friendships for select
  using (user_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Users can delete their friendships" on public.friendships;
create policy "Users can delete their friendships"
  on public.friendships for delete
  using (user_id = (select auth.jwt() ->> 'sub'));

create or replace function public._friendship_exists(p_user_a text, p_user_b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.user_id = p_user_a
      and f.friend_id = p_user_b
  );
$$;

create or replace function public._relationship_with_user(p_other_user_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
begin
  if v_me is null or p_other_user_id is null or p_other_user_id = v_me then
    return 'none';
  end if;

  if public._friendship_exists(v_me, p_other_user_id) then
    return 'friends';
  end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.from_user_id = v_me
      and fr.to_user_id = p_other_user_id
      and fr.status = 'pending'
  ) then
    return 'pending_sent';
  end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.from_user_id = p_other_user_id
      and fr.to_user_id = v_me
      and fr.status = 'pending'
  ) then
    return 'pending_received';
  end if;

  return 'none';
end;
$$;

drop function if exists public.search_profiles(text, integer);

create or replace function public.search_profiles(p_query text, p_limit integer default 10)
returns table (
  user_id text,
  username text,
  display_name text,
  avatar_url text,
  relationship text,
  level integer,
  percent_to_next numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 20));
begin
  if v_me is null then
    return;
  end if;

  if v_query = '' then
    return;
  end if;

  return query
  select
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    public._relationship_with_user(p.user_id) as relationship,
    coalesce(up.level, 1) as level,
    case
      when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
        then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
      else 0
    end as percent_to_next
  from public.profiles p
  left join public.user_progression up on up.user_id = p.user_id
  where p.user_id <> v_me
    and (
      (p.username is not null and p.username ilike v_query || '%')
      or p.user_id ilike v_query || '%'
    )
  order by
    case when p.username ilike v_query || '%' then 0 else 1 end,
    p.username nulls last,
    p.created_at asc
  limit v_limit;
end;
$$;

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
    select 1 from public.profiles p
    where p.user_id = v_target
      and coalesce(p.allow_friend_requests, true) is not true
  ) then
    raise exception 'friend_requests_disabled';
  end if;

  if exists (
    select 1 from public.friend_requests fr
    where fr.from_user_id = v_me
      and fr.to_user_id = v_target
      and fr.status = 'pending'
  ) then
    raise exception 'request_already_sent';
  end if;

  update public.friend_requests fr
  set status = 'pending', updated_at = now()
  where fr.from_user_id = v_me
    and fr.to_user_id = v_target
    and fr.status in ('declined', 'cancelled')
  returning fr.id into v_request_id;

  if v_request_id is not null then
    return v_request_id;
  end if;

  insert into public.friend_requests (from_user_id, to_user_id, status)
  values (v_me, v_target, 'pending')
  returning id into v_request_id;

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
end;
$$;

create or replace function public.decline_friend_request(p_request_id uuid)
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

  update public.friend_requests fr
  set status = 'declined', updated_at = now()
  where fr.id = p_request_id
    and fr.to_user_id = v_me
    and fr.status = 'pending';

  if not found then
    raise exception 'request_not_found';
  end if;
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
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

  update public.friend_requests fr
  set status = 'cancelled', updated_at = now()
  where fr.id = p_request_id
    and fr.from_user_id = v_me
    and fr.status = 'pending';

  if not found then
    raise exception 'request_not_found';
  end if;
end;
$$;

create or replace function public.remove_friend(p_friend_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_friend text := trim(coalesce(p_friend_user_id, ''));
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if v_friend = '' then
    raise exception 'invalid_friend';
  end if;

  delete from public.friendships f
  where (f.user_id = v_me and f.friend_id = v_friend)
     or (f.user_id = v_friend and f.friend_id = v_me);
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

grant execute on function public.search_profiles(text, integer) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(text) to authenticated;
grant execute on function public.get_friends_dashboard() to authenticated;
