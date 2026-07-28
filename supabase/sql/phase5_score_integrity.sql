-- Phase 5: score integrity — rate-limit session inserts + tighten WPM cap.
-- Existing real scores peak ~95 WPM; multiplayer burst cap is 280.

-- Tighten WPM / raw WPM ceiling (was 500)
alter table public.typing_sessions drop constraint if exists typing_sessions_wpm_range;
alter table public.typing_sessions drop constraint if exists typing_sessions_raw_wpm_range;

alter table public.typing_sessions
  add constraint typing_sessions_wpm_range
    check (wpm is null or (wpm >= 0 and wpm <= 350));

alter table public.typing_sessions
  add constraint typing_sessions_raw_wpm_range
    check (raw_wpm is null or (raw_wpm >= 0 and raw_wpm <= 350));

-- Rate limit: max 40 inserts per user per rolling 10 minutes (blocks spam floods)
create or replace function public.typing_sessions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if new.user_id is null or trim(new.user_id) = '' then
    raise exception 'invalid_user';
  end if;

  select count(*)::integer into v_count
  from public.typing_sessions ts
  where ts.user_id = new.user_id
    and ts.created_at > (now() - interval '10 minutes');

  if v_count >= 40 then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            hint = 'Too many tests saved recently. Wait a few minutes and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists typing_sessions_rate_limit on public.typing_sessions;
create trigger typing_sessions_rate_limit
  before insert on public.typing_sessions
  for each row
  execute function public.typing_sessions_rate_limit();

revoke all on function public.typing_sessions_rate_limit() from public, anon, authenticated;
