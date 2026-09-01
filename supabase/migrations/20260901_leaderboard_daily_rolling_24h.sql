-- Daily leaderboards: rolling 24-hour window instead of calendar UTC day.

drop function if exists public.get_leaderboard(text, integer, text, integer);

create or replace function public.get_leaderboard(
  p_mode text,
  p_amount integer,
  p_timeframe text default 'alltime',
  p_limit integer default 50
)
returns table (
  rank bigint,
  user_id text,
  username text,
  avatar_url text,
  wpm numeric,
  raw_wpm numeric,
  accuracy numeric,
  consistency numeric,
  session_created_at timestamptz,
  level integer,
  percent_to_next numeric,
  country_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with user_test_counts as (
    select
      ts.user_id,
      count(*)::integer as completed_tests
    from public.typing_sessions ts
    where ts.failed = false
    group by ts.user_id
  ),
  filtered_sessions as (
    select
      ts.user_id,
      ts.wpm,
      ts.raw_wpm,
      ts.accuracy,
      ts.consistency,
      ts.created_at
    from public.typing_sessions ts
    inner join public.profiles p on p.user_id = ts.user_id
    left join user_test_counts utc on utc.user_id = ts.user_id
    where ts.mode = p_mode
      and ts.amount = p_amount
      and ts.failed = false
      and ts.accuracy >= 75
      and p.show_on_leaderboard = true
      and (
        (
          p_timeframe = 'alltime'
          and ts.wpm >= 30
          and coalesce(utc.completed_tests, 0) >= 50
        )
        or (p_timeframe = 'daily' and ts.created_at >= timezone('utc', now()) - interval '24 hours')
        or (p_timeframe = 'weekly' and ts.created_at >= timezone('utc', now()) - interval '7 days')
      )
  ),
  best_per_user as (
    select distinct on (fs.user_id)
      fs.user_id,
      fs.wpm,
      fs.raw_wpm,
      fs.accuracy,
      fs.consistency,
      fs.created_at as session_created_at
    from filtered_sessions fs
    order by fs.user_id, fs.wpm desc, fs.accuracy desc nulls last, fs.created_at asc
  ),
  ranked as (
    select
      row_number() over (
        order by bpu.wpm desc, bpu.accuracy desc nulls last, bpu.session_created_at asc
      ) as rank,
      bpu.user_id,
      bpu.wpm,
      bpu.raw_wpm,
      bpu.accuracy,
      bpu.consistency,
      bpu.session_created_at
    from best_per_user bpu
  )
  select
    r.rank,
    r.user_id,
    coalesce(p.username, p.display_name, 'Player') as username,
    public._visible_avatar_url(p.user_id, p.avatar_url) as avatar_url,
    r.wpm,
    r.raw_wpm,
    r.accuracy,
    r.consistency,
    r.session_created_at,
    coalesce(up.level, 1) as level,
    case
      when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
        then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
      else 0
    end as percent_to_next,
    p.country_code
  from ranked r
  inner join public.profiles p on p.user_id = r.user_id
  left join public.user_progression up on up.user_id = r.user_id
  order by r.rank
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.get_my_leaderboard_rank(
  p_mode text default 'time',
  p_amount integer default 30,
  p_timeframe text default 'alltime'
)
returns table (
  rank bigint,
  wpm numeric,
  accuracy numeric,
  total_players bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select coalesce(
      nullif(auth.jwt() ->> 'sub', ''),
      nullif(auth.jwt() ->> 'user_id', '')
    ) as user_id
  ),
  user_test_counts as (
    select
      ts.user_id,
      count(*)::integer as completed_tests
    from public.typing_sessions ts
    where ts.failed = false
    group by ts.user_id
  ),
  filtered_sessions as (
    select
      ts.user_id,
      ts.wpm,
      ts.accuracy,
      ts.created_at
    from public.typing_sessions ts
    inner join public.profiles p on p.user_id = ts.user_id
    left join user_test_counts utc on utc.user_id = ts.user_id
    where ts.mode = p_mode
      and ts.amount = p_amount
      and ts.failed = false
      and ts.accuracy >= 75
      and p.show_on_leaderboard = true
      and (
        (
          p_timeframe = 'alltime'
          and ts.wpm >= 30
          and coalesce(utc.completed_tests, 0) >= 50
        )
        or (p_timeframe = 'daily' and ts.created_at >= timezone('utc', now()) - interval '24 hours')
        or (p_timeframe = 'weekly' and ts.created_at >= timezone('utc', now()) - interval '7 days')
      )
  ),
  best_per_user as (
    select distinct on (fs.user_id)
      fs.user_id,
      fs.wpm,
      fs.accuracy,
      fs.created_at as session_created_at
    from filtered_sessions fs
    order by fs.user_id, fs.wpm desc, fs.accuracy desc nulls last, fs.created_at asc
  ),
  ranked as (
    select
      row_number() over (
        order by bpu.wpm desc, bpu.accuracy desc nulls last, bpu.session_created_at asc
      ) as rank,
      bpu.user_id,
      bpu.wpm,
      bpu.accuracy
    from best_per_user bpu
  ),
  totals as (
    select count(*)::bigint as total_players from ranked
  )
  select
    r.rank,
    r.wpm,
    r.accuracy,
    t.total_players
  from ranked r
  cross join totals t
  inner join me on me.user_id is not null and me.user_id = r.user_id;
$$;

create or replace function public.get_country_leaderboard(
  p_country_code text,
  p_mode text default 'time',
  p_amount integer default 30,
  p_timeframe text default 'alltime',
  p_limit integer default 50
)
returns table (
  rank bigint,
  user_id text,
  username text,
  avatar_url text,
  wpm numeric,
  raw_wpm numeric,
  accuracy numeric,
  consistency numeric,
  session_created_at timestamptz,
  level integer,
  percent_to_next numeric,
  country_code text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select upper(nullif(trim(p_country_code), '')) as code
  ),
  user_test_counts as (
    select
      ts.user_id,
      count(*)::integer as completed_tests
    from public.typing_sessions ts
    where ts.failed = false
    group by ts.user_id
  ),
  filtered_sessions as (
    select
      ts.user_id,
      ts.wpm,
      ts.raw_wpm,
      ts.accuracy,
      ts.consistency,
      ts.created_at
    from public.typing_sessions ts
    inner join public.profiles p on p.user_id = ts.user_id
    cross join normalized n
    left join user_test_counts utc on utc.user_id = ts.user_id
    where n.code is not null
      and p.country_code = n.code
      and ts.mode = p_mode
      and ts.amount = p_amount
      and ts.failed = false
      and ts.accuracy >= 75
      and p.show_on_leaderboard = true
      and (
        (
          p_timeframe = 'alltime'
          and ts.wpm >= 30
          and coalesce(utc.completed_tests, 0) >= 50
        )
        or (p_timeframe = 'daily' and ts.created_at >= timezone('utc', now()) - interval '24 hours')
        or (p_timeframe = 'weekly' and ts.created_at >= timezone('utc', now()) - interval '7 days')
      )
  ),
  best_per_user as (
    select distinct on (fs.user_id)
      fs.user_id,
      fs.wpm,
      fs.raw_wpm,
      fs.accuracy,
      fs.consistency,
      fs.created_at as session_created_at
    from filtered_sessions fs
    order by fs.user_id, fs.wpm desc, fs.accuracy desc nulls last, fs.created_at asc
  ),
  ranked as (
    select
      row_number() over (
        order by bpu.wpm desc, bpu.accuracy desc nulls last, bpu.session_created_at asc
      ) as rank,
      bpu.user_id,
      bpu.wpm,
      bpu.raw_wpm,
      bpu.accuracy,
      bpu.consistency,
      bpu.session_created_at
    from best_per_user bpu
  )
  select
    r.rank,
    r.user_id,
    coalesce(p.username, p.display_name, 'Player') as username,
    public._visible_avatar_url(p.user_id, p.avatar_url) as avatar_url,
    r.wpm,
    r.raw_wpm,
    r.accuracy,
    r.consistency,
    r.session_created_at,
    coalesce(up.level, 1) as level,
    case
      when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
        then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
      else 0
    end as percent_to_next,
    p.country_code
  from ranked r
  inner join public.profiles p on p.user_id = r.user_id
  left join public.user_progression up on up.user_id = r.user_id
  order by r.rank
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.get_friends_leaderboard(
  p_mode text default 'time',
  p_amount integer default 30,
  p_timeframe text default 'alltime',
  p_limit integer default 50
)
returns table (
  rank bigint,
  user_id text,
  username text,
  avatar_url text,
  wpm numeric,
  raw_wpm numeric,
  accuracy numeric,
  consistency numeric,
  session_created_at timestamptz,
  level integer,
  percent_to_next numeric,
  country_code text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := coalesce(
    nullif(auth.jwt() ->> 'sub', ''),
    nullif(auth.jwt() ->> 'user_id', '')
  );
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  return query
  with circle as (
    select v_me as user_id
    union
    select f.friend_id
    from public.friendships f
    where f.user_id = v_me
  ),
  user_test_counts as (
    select
      ts.user_id,
      count(*)::integer as completed_tests
    from public.typing_sessions ts
    inner join circle c on c.user_id = ts.user_id
    where ts.failed = false
    group by ts.user_id
  ),
  filtered_sessions as (
    select
      ts.user_id,
      ts.wpm,
      ts.raw_wpm,
      ts.accuracy,
      ts.consistency,
      ts.created_at
    from public.typing_sessions ts
    inner join circle c on c.user_id = ts.user_id
    inner join public.profiles p on p.user_id = ts.user_id
    left join user_test_counts utc on utc.user_id = ts.user_id
    where ts.mode = p_mode
      and ts.amount = p_amount
      and ts.failed = false
      and ts.accuracy >= 75
      and (
        p.show_on_leaderboard = true
        or p.user_id = v_me
      )
      and (
        (
          p_timeframe = 'alltime'
          and ts.wpm >= 30
          and coalesce(utc.completed_tests, 0) >= 50
        )
        or (p_timeframe = 'daily' and ts.created_at >= timezone('utc', now()) - interval '24 hours')
        or (p_timeframe = 'weekly' and ts.created_at >= timezone('utc', now()) - interval '7 days')
      )
  ),
  best_per_user as (
    select distinct on (fs.user_id)
      fs.user_id,
      fs.wpm,
      fs.raw_wpm,
      fs.accuracy,
      fs.consistency,
      fs.created_at as session_created_at
    from filtered_sessions fs
    order by fs.user_id, fs.wpm desc, fs.accuracy desc nulls last, fs.created_at asc
  ),
  ranked as (
    select
      row_number() over (
        order by bpu.wpm desc, bpu.accuracy desc nulls last, bpu.session_created_at asc
      ) as rank,
      bpu.user_id,
      bpu.wpm,
      bpu.raw_wpm,
      bpu.accuracy,
      bpu.consistency,
      bpu.session_created_at
    from best_per_user bpu
  )
  select
    r.rank,
    r.user_id,
    coalesce(p.username, p.display_name, 'Player')::text,
    public._visible_avatar_url(p.user_id, p.avatar_url),
    r.wpm,
    r.raw_wpm,
    r.accuracy,
    r.consistency,
    r.session_created_at,
    coalesce(up.level, 1),
    case
      when public.xp_needed_for_level(coalesce(up.level, 1)) > 0
        then round((coalesce(up.xp_into_level, 0)::numeric / public.xp_needed_for_level(coalesce(up.level, 1))) * 1000) / 10
      else 0
    end,
    p.country_code
  from ranked r
  inner join public.profiles p on p.user_id = r.user_id
  left join public.user_progression up on up.user_id = r.user_id
  order by r.rank
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;
