# Staging + production: stop writing friend inbox rows to Supabase Postgres.
# Creates still run from send/accept RPCs, but create_notification becomes a no-op.
# The Cloudflare notifications Worker + D1 owns the inbox.

create or replace function public.create_notification(
  p_user_id text,
  p_type text,
  p_title text,
  p_body text default null,
  p_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally no insert — staging inbox is Cloudflare D1.
  return gen_random_uuid();
end;
$$;
