-- Public community aggregates + optional country code on profiles.
-- Applied remotely via Supabase; kept here for repo history.

alter table public.profiles
  add column if not exists country_code text;

alter table public.profiles
  drop constraint if exists profiles_country_code_check;

alter table public.profiles
  add constraint profiles_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

comment on column public.profiles.country_code is
  'ISO 3166-1 alpha-2 country from CDN geo; used only for aggregate community stats';

create or replace function public.get_public_site_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  totals jsonb;
  countries jsonb;
  score_bins jsonb;
  activity jsonb;
  modes jsonb;
  languages jsonb;
  score_meta record;
begin
  select jsonb_build_object(
    'users', (select count(*)::int from public.profiles),
    'tests_taken', (select count(*)::int from public.typing_sessions),
    'tests_completed', (select count(*)::int from public.typing_sessions where failed = false),
    'total_seconds', (select coalesce(sum(duration_seconds), 0)::bigint from public.typing_sessions),
    'total_words', (
      select coalesce(sum(greatest(correct_chars, 0) / 5), 0)::bigint
      from public.typing_sessions
    ),
    'avg_wpm', (
      select round(avg(wpm)::numeric, 1)
      from public.typing_sessions
      where failed = false and wpm > 0
    ),
    'avg_accuracy', (
      select round(avg(accuracy)::numeric, 1)
      from public.typing_sessions
      where failed = false and accuracy is not null
    ),
    'personal_bests', (select count(*)::int from public.typing_sessions where is_pb = true),
    'tests_30s', (
      select count(*)::int
      from public.typing_sessions
      where failed = false and mode = 'time' and amount = 30
    )
  )
  into totals;

  with country_counts as (
    select country_code as code, count(*)::int as users
    from public.profiles
    where country_code is not null
    group by country_code
  ),
  ranked as (
    select code, users, row_number() over (order by users desc, code asc) as rn
    from country_counts
  ),
  top5 as (
    select jsonb_agg(
      jsonb_build_object('code', code, 'users', users)
      order by users desc, code asc
    ) as items
    from ranked
    where rn <= 5
  ),
  other_row as (
    select coalesce(sum(users), 0)::int as users
    from ranked
    where rn > 5
  ),
  totals_c as (
    select coalesce(sum(users), 0)::int as users
    from country_counts
  )
  select jsonb_build_object(
    'items', coalesce((select items from top5), '[]'::jsonb),
    'other', coalesce((select users from other_row), 0),
    'total_users_with_country', coalesce((select users from totals_c), 0)
  )
  into countries;

  select
    count(*)::int as total,
    coalesce(avg(wpm), 0)::numeric as average,
    coalesce(min(wpm), 0)::numeric as min_wpm,
    coalesce(max(wpm), 0)::numeric as max_wpm,
    greatest(5, ceil(coalesce(max(wpm), 0) / 5.0) * 5)::int as upper
  into score_meta
  from public.typing_sessions
  where failed = false
    and mode = 'time'
    and amount = 30
    and wpm > 0;

  if score_meta.total = 0 then
    score_bins := jsonb_build_object(
      'bins', '[]'::jsonb,
      'total', 0,
      'average', null,
      'min', null,
      'max', null,
      'maxCount', 0
    );
  else
    with filtered as (
      select wpm::numeric as wpm
      from public.typing_sessions
      where failed = false
        and mode = 'time'
        and amount = 30
        and wpm > 0
    ),
    series as (
      select generate_series(0, score_meta.upper - 5, 5) as start
    ),
    counted as (
      select
        s.start,
        s.start + 5 as "end",
        count(f.wpm)::int as count
      from series s
      left join filtered f
        on f.wpm >= s.start
       and (
         f.wpm < s.start + 5
         or (s.start + 5 = score_meta.upper and f.wpm <= s.start + 5)
       )
      group by s.start
    )
    select jsonb_build_object(
      'bins', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('start', start, 'end', "end", 'count', count)
            order by start
          )
          from counted
        ),
        '[]'::jsonb
      ),
      'total', score_meta.total,
      'average', round(score_meta.average::numeric, 1),
      'min', round(score_meta.min_wpm::numeric, 1),
      'max', round(score_meta.max_wpm::numeric, 1),
      'maxCount', coalesce((select max(count) from counted), 0)
    )
    into score_bins
    from counted
    limit 1;
  end if;

  with days as (
    select generate_series(
      (timezone('utc', now()))::date - 13,
      (timezone('utc', now()))::date,
      interval '1 day'
    )::date as day
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', d.day,
        'tests', coalesce(c.tests, 0)
      )
      order by d.day
    ),
    '[]'::jsonb
  )
  into activity
  from days d
  left join lateral (
    select count(*)::int as tests
    from public.typing_sessions ts
    where ts.failed = false
      and (ts.created_at at time zone 'utc')::date = d.day
  ) c on true;

  select coalesce(
    jsonb_agg(item order by (item->>'tests')::int desc),
    '[]'::jsonb
  )
  into modes
  from (
    select jsonb_build_object(
      'mode', mode,
      'amount', amount,
      'tests', count(*)::int
    ) as item
    from public.typing_sessions
    where failed = false
    group by mode, amount
    order by count(*) desc
    limit 8
  ) q;

  with lang_counts as (
    select coalesce(nullif(trim(language), ''), 'english') as language, count(*)::int as tests
    from public.typing_sessions
    where failed = false
    group by 1
  ),
  ranked_lang as (
    select language, tests, row_number() over (order by tests desc, language asc) as rn
    from lang_counts
  ),
  top_lang as (
    select jsonb_agg(
      jsonb_build_object('language', language, 'tests', tests)
      order by tests desc, language asc
    ) as items
    from ranked_lang
    where rn <= 5
  ),
  other_lang as (
    select coalesce(sum(tests), 0)::int as tests
    from ranked_lang
    where rn > 5
  )
  select jsonb_build_object(
    'items', coalesce((select items from top_lang), '[]'::jsonb),
    'other', coalesce((select tests from other_lang), 0)
  )
  into languages;

  return jsonb_build_object(
    'totals', totals,
    'countries', countries,
    'score_distribution_30s', score_bins,
    'activity_14d', activity,
    'popular_modes', modes,
    'languages', languages,
    'generated_at', timezone('utc', now())
  );
end;
$function$;

revoke all on function public.get_public_site_stats() from public;
grant execute on function public.get_public_site_stats() to anon, authenticated;
