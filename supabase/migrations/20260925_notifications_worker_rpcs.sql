-- Friend lookups for the notifications Worker, called with the user's Clerk JWT.
-- friend_requests / friendships have no direct table grants for authenticated
-- (phase4_security_hardening), so the Worker must go through these instead.

create or replace function public.notify_pending_friend_requests()
returns table (
  id uuid,
  from_user_id text,
  to_user_id text,
  status text,
  from_label text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    fr.id,
    fr.from_user_id,
    fr.to_user_id,
    fr.status,
    public.profile_display_label(fr.from_user_id) as from_label
  from public.friend_requests fr
  where fr.to_user_id = (auth.jwt() ->> 'sub')
    and fr.status = 'pending'
  order by fr.created_at desc
  limit 50;
$$;

create or replace function public.notify_friend_request(p_request_id uuid)
returns table (
  id uuid,
  from_user_id text,
  to_user_id text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select fr.id, fr.from_user_id, fr.to_user_id, fr.status
  from public.friend_requests fr
  where fr.id = p_request_id
    and (auth.jwt() ->> 'sub') in (fr.from_user_id, fr.to_user_id);
$$;

create or replace function public.notify_is_friend(p_other_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.user_id = (auth.jwt() ->> 'sub')
      and f.friend_id = p_other_user_id
  );
$$;

revoke all on function public.notify_pending_friend_requests() from public, anon;
revoke all on function public.notify_friend_request(uuid) from public, anon;
revoke all on function public.notify_is_friend(text) from public, anon;

grant execute on function public.notify_pending_friend_requests() to authenticated, service_role;
grant execute on function public.notify_friend_request(uuid) to authenticated, service_role;
grant execute on function public.notify_is_friend(text) to authenticated, service_role;
