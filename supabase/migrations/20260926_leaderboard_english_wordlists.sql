-- Count every English frequency word list (english, english_1k, english_2k, english_5k,
-- english_10k, english_25k, english_450k) as English on the leaderboards.
-- Themed lists (english_medical, english_old, ...) and english_ze* stay excluded.

do $mig$
declare
  fn record;
  def text;
  old_pred constant text := $p$lower(COALESCE(NULLIF(TRIM(BOTH FROM ts.language), ''::text), 'english'::text)) = 'english'::text$p$;
  new_pred constant text := $p$lower(COALESCE(NULLIF(TRIM(BOTH FROM ts.language), ''::text), 'english'::text)) ~ '^english(_[0-9]+k)?$'::text$p$;
  src_old constant text := $p$lower(coalesce(nullif(trim(ts.language), ''), 'english')) = 'english'$p$;
  src_new constant text := $p$lower(coalesce(nullif(trim(ts.language), ''), 'english')) ~ '^english(_[0-9]+k)?$'$p$;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in (
        'get_leaderboard',
        'get_my_leaderboard_rank',
        'get_country_leaderboard',
        'get_friends_leaderboard',
        'list_leaderboard_countries'
      )
  loop
    def := pg_get_functiondef(fn.oid);
    def := replace(def, src_old, src_new);
    def := replace(def, old_pred, new_pred);
    execute def;
  end loop;
end
$mig$;
