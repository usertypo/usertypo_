-- Account-synced Look & Feel (themes). Metadata only — no background images.
alter table public.profiles
  add column if not exists look_feel jsonb not null default '{}'::jsonb;

comment on column public.profiles.look_feel is
  'Account-synced Look & Feel: colorTheme, customTheme, customPresets, fontFamily, glowIntensity, randomizeTheme, updatedAt. Images stay out of Postgres.';
