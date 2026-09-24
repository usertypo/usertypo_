-- Account-synced Look & Feel (themes). Metadata only — no background images.
-- Apply on each Supabase project (dev + prod). RLS on profiles already scopes
-- SELECT/UPDATE to auth.jwt() ->> 'sub', so look_feel is private to the owner.

alter table public.profiles
  add column if not exists look_feel jsonb not null default '{}'::jsonb;

comment on column public.profiles.look_feel is
  'Account-synced Look & Feel: colorTheme, customTheme, customPresets, fontFamily, glowIntensity, randomizeTheme, updatedAt. Images stay out of Postgres.';
