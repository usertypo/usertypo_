-- Lean one-way blocks. Blocker cannot be friends with blocked (must unfriend first).
-- Blocks cancel pending friend requests between the pair.

create table if not exists public.user_blocks (
  blocker_id text not null references public.profiles (user_id) on delete cascade,
  blocked_id text not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_id_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "Users can view own blocks" on public.user_blocks;
create policy "Users can view own blocks"
  on public.user_blocks for select
  using (blocker_id = (auth.jwt() ->> 'sub'));

-- True if either user has blocked the other.
create or replace function public._block_exists(p_a text, p_b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = p_a and ub.blocked_id = p_b)
       or (ub.blocker_id = p_b and ub.blocked_id = p_a)
  );
$$;

-- Hide avatar URL when the profile owner has blocked the viewer.
create or replace function public._visible_avatar_url(p_owner text, p_url text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_url is null or btrim(p_url) = '' then null
    when exists (
      select 1 from public.user_blocks ub
      where ub.blocker_id = p_owner
        and ub.blocked_id = (auth.jwt() ->> 'sub')
    ) then null
    else p_url
  end;
$$;

revoke all on function public._visible_avatar_url(text, text) from public;
create or replace function public.block_user(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_target text := trim(coalesce(p_user_id, ''));
begin
  if v_me is null or trim(v_me) = '' then
    raise exception 'not_authenticated';
  end if;

  if v_target = '' or v_target = v_me then
    raise exception 'invalid_target';
  end if;

  if not exists (select 1 from public.profiles p where p.user_id = v_target) then
    raise exception 'user_not_found';
  end if;

  if public._friendship_exists(v_me, v_target) then
    raise exception 'cannot_block_friend';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, v_target)
  on conflict do nothing;

  -- Drop any pending requests either way so neither can accept later.
  update public.friend_requests fr
  set status = 'cancelled', updated_at = now()
  where fr.status = 'pending'
    and (
      (fr.from_user_id = v_me and fr.to_user_id = v_target)
      or (fr.from_user_id = v_target and fr.to_user_id = v_me)
    );
end;
$$;

create or replace function public.unblock_user(p_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := auth.jwt() ->> 'sub';
  v_target text := trim(coalesce(p_user_id, ''));
begin
  if v_me is null or trim(v_me) = '' then
    raise exception 'not_authenticated';
  end if;

  if v_target = '' then
    raise exception 'invalid_target';
  end if;

  delete from public.user_blocks ub
  where ub.blocker_id = v_me
    and ub.blocked_id = v_target;
end;
$$;

revoke all on function public._block_exists(text, text) from public;
revoke all on function public._visible_avatar_url(text, text) from public;
revoke all on function public.block_user(text) from public;
revoke all on function public.unblock_user(text) from public;
grant execute on function public.block_user(text) to authenticated;
grant execute on function public.unblock_user(text) to authenticated;
-- Multiplayer (service role) needs a lean either-way check.
grant execute on function public._block_exists(text, text) to service_role;
grant select on table public.user_blocks to service_role;
grant select on table public.user_blocks to authenticated;

-- Lean: which of these users have blocked the caller (for Redis leaderboard avatar strip).
create or replace function public.ids_who_blocked_me(p_ids text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(ub.blocker_id), '{}'::text[])
  from public.user_blocks ub
  where ub.blocked_id = (auth.jwt() ->> 'sub')
    and ub.blocker_id = any (coalesce(p_ids, '{}'::text[]));
$$;

revoke all on function public.ids_who_blocked_me(text[]) from public;
grant execute on function public.ids_who_blocked_me(text[]) to authenticated;
