-- Admin "last online": last_seen_at is cleared by go_offline (so friends see
-- offline quickly), which erased the only activity timestamp. last_active_at is
-- never cleared: heartbeat bumps it, and go_offline stamps the moment they left.

alter table public.profiles
  add column if not exists last_active_at timestamptz;

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
  set last_seen_at = now(), last_active_at = now(), updated_at = now()
  where user_id = v_me;
end;
$$;

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
  set last_seen_at = null, last_active_at = now(), updated_at = now()
  where user_id = v_me;
end;
$$;

-- Backfill from the best evidence we have: presence, finished tests, site visits.
with activity as (
  select p.user_id,
    greatest(
      p.last_seen_at,
      (select max(t.created_at) from public.typing_sessions t where t.user_id = p.user_id),
      (select max(coalesce(v.ended_at, v.last_heartbeat_at, v.started_at))
         from public.visit_sessions v where v.user_id = p.user_id)
    ) as seen
  from public.profiles p
)
update public.profiles p
set last_active_at = a.seen
from activity a
where a.user_id = p.user_id
  and a.seen is not null
  and (p.last_active_at is null or p.last_active_at < a.seen);

create index if not exists profiles_last_active_idx
  on public.profiles (last_active_at desc nulls last);
