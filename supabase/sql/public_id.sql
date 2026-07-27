-- Public 8-char alphanumeric IDs for friend search.
-- Clerk user_id remains the internal PK for auth/FKs; public_id is what users share/search.

create or replace function public.generate_public_id()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_id text;
  v_i integer;
  v_attempts integer := 0;
begin
  loop
    v_id := '';
    for v_i in 1..8 loop
      v_id := v_id || substr(v_alphabet, 1 + floor(random() * 36)::integer, 1);
    end loop;

    exit when not exists (
      select 1 from public.profiles p where p.public_id = v_id
    );

    v_attempts := v_attempts + 1;
    if v_attempts > 50 then
      raise exception 'public_id_generation_failed';
    end if;
  end loop;

  return v_id;
end;
$$;

alter table public.profiles
  add column if not exists public_id text;

update public.profiles
set public_id = public.generate_public_id()
where public_id is null or trim(public_id) = '';

alter table public.profiles
  alter column public_id set not null;

alter table public.profiles
  drop constraint if exists profiles_public_id_format;

alter table public.profiles
  add constraint profiles_public_id_format
  check (public_id ~ '^[A-Z0-9]{8}$');

create unique index if not exists profiles_public_id_uidx
  on public.profiles (public_id);

create or replace function public.profiles_assign_public_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.public_id is null or trim(new.public_id) = '' then
      new.public_id := public.generate_public_id();
    else
      new.public_id := upper(regexp_replace(trim(new.public_id), '[^A-Za-z0-9]', '', 'g'));
      if new.public_id !~ '^[A-Z0-9]{8}$' then
        new.public_id := public.generate_public_id();
      end if;
    end if;
    return new;
  end if;

  -- Keep public_id immutable after creation.
  if new.public_id is distinct from old.public_id then
    new.public_id := old.public_id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_public_id on public.profiles;
create trigger profiles_assign_public_id
  before insert or update on public.profiles
  for each row execute function public.profiles_assign_public_id();

drop function if exists public.search_profiles(text, integer);

create or replace function public.search_profiles(p_query text, p_limit integer default 10)
returns table (
  user_id text,
  public_id text,
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
  v_query_upper text;
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 20));
begin
  if v_me is null then
    return;
  end if;

  if v_query = '' then
    return;
  end if;

  v_query_upper := upper(v_query);

  return query
  select
    p.user_id,
    p.public_id,
    p.username,
    p.display_name,
    public._visible_avatar_url(p.user_id, p.avatar_url) as avatar_url,
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
      or p.public_id ilike v_query_upper || '%'
    )
  order by
    case when p.public_id = v_query_upper then 0
         when p.username ilike v_query || '%' then 1
         else 2 end,
    p.username nulls last,
    p.created_at asc
  limit v_limit;
end;
$$;

grant execute on function public.generate_public_id() to authenticated;
grant execute on function public.search_profiles(text, integer) to authenticated;
