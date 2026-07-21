-- Compact per-test diagnostics for Error Diagnostics & Weakness Analysis.
-- Keep at most 100 rows per user (oldest summaries deleted; typing_sessions rows stay).

create table if not exists public.typing_session_diagnostics (
  session_id uuid primary key references public.typing_sessions(id) on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  summary jsonb not null
);

create index if not exists typing_session_diagnostics_user_created_idx
  on public.typing_session_diagnostics (user_id, created_at desc);

alter table public.typing_session_diagnostics enable row level security;

drop policy if exists "Users can view their own diagnostics" on public.typing_session_diagnostics;
create policy "Users can view their own diagnostics"
  on public.typing_session_diagnostics
  for select
  using ((select auth.jwt() ->> 'sub') = user_id);

drop policy if exists "Users can insert their own diagnostics" on public.typing_session_diagnostics;
create policy "Users can insert their own diagnostics"
  on public.typing_session_diagnostics
  for insert
  with check ((select auth.jwt() ->> 'sub') = user_id);

drop policy if exists "Users can delete their own diagnostics" on public.typing_session_diagnostics;
create policy "Users can delete their own diagnostics"
  on public.typing_session_diagnostics
  for delete
  using ((select auth.jwt() ->> 'sub') = user_id);

create or replace function public.trim_typing_session_diagnostics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.typing_session_diagnostics d
  where d.user_id = new.user_id
    and d.session_id in (
      select session_id
      from public.typing_session_diagnostics
      where user_id = new.user_id
      order by created_at desc
      offset 100
    );
  return new;
end;
$$;

drop trigger if exists typing_session_diagnostics_trim on public.typing_session_diagnostics;
create trigger typing_session_diagnostics_trim
  after insert on public.typing_session_diagnostics
  for each row
  execute function public.trim_typing_session_diagnostics();
