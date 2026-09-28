-- Admin tools: site announcement banner, admin account delete, per-user test
-- filter facets, and service_role grants for badge management.
-- Apply on staging then production (after 20260928_builder_badge.sql).

-- ---------------------------------------------------------------------------
-- Site announcement (at most one active; read by every visitor)
-- ---------------------------------------------------------------------------
create table if not exists public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(message) between 1 and 500),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists site_announcements_one_active
  on public.site_announcements (active)
  where active;

alter table public.site_announcements enable row level security;

drop policy if exists site_announcements_no_direct on public.site_announcements;
create policy site_announcements_no_direct on public.site_announcements
  for all
  using (false)
  with check (false);

grant select, insert, update, delete on public.site_announcements to service_role;

create or replace function public.get_site_announcement()
returns table (
  id uuid,
  message text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.message, a.updated_at
  from public.site_announcements a
  where a.active
  order by a.updated_at desc
  limit 1;
$$;

revoke all on function public.get_site_announcement() from public;
grant execute on function public.get_site_announcement() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin account delete (same app data as delete_my_account_data, by user id).
-- user_badges rows are kept so First 100 / First 1K slots stay taken.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_account_data(p_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions integer := 0;
begin
  if p_user_id is null or trim(p_user_id) = '' then
    raise exception 'bad_request';
  end if;

  delete from public.typing_session_diagnostics d where d.user_id = p_user_id;
  delete from public.xp_events x where x.user_id = p_user_id;
  delete from public.typing_sessions ts where ts.user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  delete from public.friend_requests fr
  where fr.from_user_id = p_user_id or fr.to_user_id = p_user_id;

  delete from public.friendships f
  where f.user_id = p_user_id or f.friend_id = p_user_id;

  delete from public.user_blocks ub
  where ub.blocker_id = p_user_id or ub.blocked_id = p_user_id;

  delete from public.user_progression up where up.user_id = p_user_id;
  delete from public.visit_sessions vs where vs.user_id = p_user_id;
  delete from public.admin_sign_in_links l where l.user_id = p_user_id;
  delete from public.profiles p where p.user_id = p_user_id;

  return jsonb_build_object('ok', true, 'sessions_deleted', v_sessions);
end;
$$;

revoke all on function public.admin_delete_account_data(text) from public, anon, authenticated;
grant execute on function public.admin_delete_account_data(text) to service_role;

-- ---------------------------------------------------------------------------
-- Filter options for one user's test list (languages + amounts they used)
-- ---------------------------------------------------------------------------
create or replace function public.admin_session_facets(p_user_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.typing_sessions where user_id = p_user_id),
    'languages', coalesce((
      select jsonb_agg(l.language order by l.n desc)
      from (
        select language, count(*) as n
        from public.typing_sessions
        where user_id = p_user_id
        group by language
      ) l
    ), '[]'::jsonb),
    'time_amounts', coalesce((
      select jsonb_agg(t.amount order by t.amount)
      from (
        select distinct amount
        from public.typing_sessions
        where user_id = p_user_id and mode = 'time'
      ) t
    ), '[]'::jsonb),
    'word_amounts', coalesce((
      select jsonb_agg(w.amount order by w.amount)
      from (
        select distinct amount
        from public.typing_sessions
        where user_id = p_user_id and mode = 'words'
      ) w
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_session_facets(text) from public, anon, authenticated;
grant execute on function public.admin_session_facets(text) to service_role;

-- ---------------------------------------------------------------------------
-- Badge management from the admin Worker
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.user_badges to service_role;
