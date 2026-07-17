-- Compute is_pb on insert server-side (removes extra client read before save).

create or replace function public.set_typing_session_is_pb()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.failed then
    new.is_pb := false;
    return new;
  end if;

  new.is_pb := not exists (
    select 1
    from public.typing_sessions ts
    where ts.user_id = new.user_id
      and ts.mode = new.mode
      and ts.amount = new.amount
      and ts.failed = false
      and ts.wpm > new.wpm
  );

  return new;
end;
$$;

drop trigger if exists typing_sessions_set_is_pb on public.typing_sessions;

create trigger typing_sessions_set_is_pb
  before insert on public.typing_sessions
  for each row
  execute function public.set_typing_session_is_pb();
