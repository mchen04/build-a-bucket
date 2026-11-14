# Rolling back the shared-league schema

Production runs `main` (28c0d2f). The shared-league deploy applies `db/schema.sql` once, immediately before the
deploy. `scripts/migrate.ts` reruns every statement on every release; the legacy phase normalisation is guarded by
`locked_at is null`, so it only touches rows created before the `locked_at` column existed. Every new-code
`building` lobby sets `locked_at`, so a rerun leaves live lobbies alone. `tests/migration.test.ts` applies the
legacy schema, migrates, creates new-code lobbies in every phase and migrates again.

## Rollback order

1. Stop new-code traffic and deploy `main`'s code, or put the app in maintenance. New-code requests must not write
   `status = 'ready'` or the new phases while the constraints are changing.
2. Normalise the status that `main`'s constraint cannot represent. This must run before `main`'s migration: its
   schema drops and re-adds `participants_status_check` without `ready`, and the add validates existing rows.
   ```sql
   update participants set status = 'joined' where status = 'ready';
   ```
3. Normalise the phases `main`'s UI does not know. The new phase check stays in place and accepts both sets, but
   `main` should not receive a phase it never writes.
   ```sql
   update lobbies set phase = case
     when phase in ('draw', 'rematch') then 'lobby'
     when phase in ('building', 'preview') then 'building'
     when phase in ('season', 'awards') then 'season'
     when phase in ('playin', 'playoffs') then 'playoffs'
     when phase = 'recap' then 'finished'
     else phase
   end
   where phase in ('draw', 'building', 'preview', 'season', 'awards', 'playin', 'playoffs', 'recap', 'rematch');
   ```
4. Run `main`'s migration (`npm run db:migrate` from `main`). It re-adds both constraints. Because step 2 ran
   first, the `participants_status_check` add does not fail on a `ready` row.
5. Verify:
   ```sql
   select count(*) from participants where status = 'ready';
   select count(*) from lobbies
   where phase not in ('lobby', 'building', 'season', 'barrier', 'playoffs', 'finished');
   ```
   Both must be 0. Then run the production smoke checks.
6. The additive tables `league_slices`, `league_slice_games` and `league_slice_checkpoints`, and the columns
   `league_claimed_at`, `league_version`, `stage`, `rematch`, `locked_at` and `preview_ready`, can stay; `main`
   ignores them. Drop the slice tables only if the storage is needed:
   ```sql
   drop table if exists league_slice_checkpoints, league_slice_games, league_slices;
   ```
   `lobbies.league` still holds every league.

Leaving the additive columns and tables in place keeps the rollback reversible: re-deploying the shared-league
code does not need a schema change beyond the statements that are already present.
