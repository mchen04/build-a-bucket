# Whole-stack performance

How fast the rebuild loads on a phone compared with the original, and how the lobby API and database behave with a full 8-player lobby.

## Sub-features

- `perf-cold` cold-load FCP, LCP, TTI-ish, `firstSpinMs`, bytes, requests, heap and long tasks under the original's baseline conditions, for the first visit and (with `--visits 2`) the repeat visit in the same context.
- `perf-lobby` p50/p95 per lobby endpoint with 8 players polling and syncing drafts, plus over-capacity joins, poll shape (full view / delta / 204) and bytes per poll.
- `perf-db` the same workload against dev, preview and production to separate database and function time.
- `perf-meter` per-journey database requests, database request and response bytes, database time p50/p95/max, API requests and API response bytes, and the static browser payload, all against a local Postgres replay so repeated load never reaches Neon.

## How to get to it (user POV)

- A player opening the home page on a phone network; eight friends in one lobby.

## Driving it with control.mjs

Preconditions:

- Machine load noted (`uptime`); nothing else heavy started during a comparison.

- **Rebuild cold load.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs launch --prod`, then `node .claude/skills/verify-build-a-bucket/scripts/control.mjs cold-load --runs 5`. Medians land in `evidence/perf/cold-load-*.json`.
- **First spin and repeat visit.** The same command reports `firstSpinMs` beside TTI-ish. Add `--visits 2` to navigate a second time in the same context: `repeatSummary` is that repeat visit, and app storage is cleared before each navigation so both visits walk the same path.
- **Original cold load.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs cold-load --runs 5 --url https://build-a-player.com/bucket` in the same session; interleave with the rebuild when comparing.
- **Lobby, dev.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs launch`, then `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --players 8 --extra 4 --seconds 20`.
- **Lobby, deployed.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --base https://<deployment> --players 8 --seconds 20`. Its lobbies stay in that database until `npm run prune:lobbies`.
- **Reading it.** A lower median outside the other side's min-max range is a gain; overlapping ranges are "no measured gain". Polls answer 204 when nothing changed, a delta when only progress moved, and a full view on joins, starts, submits and phase changes; bytes per poll is the number to watch while players build.

## DB transfer meter

`node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 [--modes normal,salary,squad] [--journeys solo,idle,league] [--tag name] [--out DIR]`

- **Local replay, never Neon.** The meter starts a throwaway Postgres cluster under `<out>/pgdata` on port 55432 (`initdb -A trust`, `fsync=off`), applies `db/schema.sql`, and starts `scripts/dev-server.ts` with `BAB_DB_RUNNER` pointing at `scripts/meter/local-pg.mjs`. That module is a `QueryRunner` that speaks the Postgres wire protocol directly, so the server's real SQL runs unchanged and every query is measured at the socket. `DATABASE_URL` is set to the local cluster as a guard; nothing in the run resolves a Neon host. The runner is only installed when `BAB_DB_RUNNER` is set, so production never loads it.
- **What the numbers mean.** `dbRequestBytes` and `dbResponseBytes` are Postgres wire bytes (message framing included, TCP/IP headers excluded) summed over the journey; `dbP50/dbP95/dbMax` are per-query round trips on localhost. `apiBytes` is the JSON the browser receives from `/api/**`; `static` is the home page plus its hashed assets fetched with `accept-encoding: identity`. Parameters are inlined as literals before the query is sent, so request bytes are the text actually sent, not the driver's binary bind.
- **Journeys.** `solo` opens the app and asserts zero database requests (Play and Daily run in the browser). `idle-lobby` seats eight players and polls each second for `--seconds`. `wait-building` and `wait-checkpoint` seat eight players, put them in the build phase or at a season checkpoint with nobody ready, and poll for `--seconds`; every poll is unchanged, which is the per-seat-minute figure for waiting. `wait-reveal` polls through a live reveal, where every poll changes. `freshness` readies one seat at a time and measures how long the rest of the group takes to see it, then the season start and a reveal; it reports p50/p95/max and the 2 s limit is the acceptance bar. `league-<mode>` runs an eight-player shared league through auto-completed builds, draw, lock, preview, every checkpoint, awards, play-in, playoffs and the recap, then Play Again into the second season; it also reloads seat 4 mid-season (`reconnect`) and records the rematch window. The reveal is compressed by backdating `stage_started_at` and setting `stage_cursor` in the local database between polls; per-poll request and response shape is unchanged, so bytes and latency stay comparable while a full journey takes about a minute instead of twelve.
- **Per-seat-minute.** `dbBytesPerSeatMinuteSteady` divides polling-window response bytes by seats times minutes, so the number follows real play rather than the number of polls the driver happens to make. Setup (create, join, draws, lock, build) is excluded; cleanup and the one-time league load show up in the whole-journey figure instead.
- **Cold cache.** `BAB_DISABLE_LEAGUE_CACHE=1` turns off the in-memory league cache; every poll then reads the league JSON, which is the worst case for a cold serverless instance. Run the same journeys with and without it and report both.
- **Freshness groups.** `freshness` reports p50/p95/max for the peer-ready, season-start and reveal groups separately; the season start includes the one-time league simulation.
- **Waiting hint.** The app sends `waiting=1` when its view is in a lobby, draw, building, preview, rematch, recap or at a season checkpoint. The route then answers an unchanged poll from one cheap probe query before the full read. Without the hint every poll takes the full read; the driver sends the same hint from its last view.
- **Real-time run.** `control.mjs league --players 2 --base <local replay server>` drives the real client with real timers; the server's `db-meter.jsonl` gives that run's per-seat-minute cost and its poll mix, and the league command now reports `phaseTimings`.
- **Repeats.** Each journey runs `--runs` times; the summary reports the median and min-max range per journey. Keep a change only when its median beats the baseline outside the baseline range.
- **Old lobby baseline.** `--legacy-settings` sends the pre-shared-league settings shape (`positions`, `revealSeconds`) so the same idle journey runs against `main`; the league journeys do not exist there.
- **Evidence.** `<out>/meter-<tag>-<timestamp>.json` holds the aggregate and every run; `<out>/db-meter.jsonl` is the raw per-query log; `<out>/server.log` is the dev server. The cluster is stopped at the end unless `--keep` is passed.

## Gotchas

- The dev server compiles modules on first request; warm it with one `ui` run before timing, or time against `--prod`/a deployment.
- `cold-load` against `launch` in dev mode measures unbundled modules; never compare it with a production build.
- Draft syncs bump the lobby version, so peers' polls return full views while anyone is building.
- `cold-load` reuses one browser process across runs, so DNS and the sockets to cdn.jsdelivr.net are already warm after the first run; a preconnect hint shows no measurable gain under it.
- The harness keeps HTTP caching off, so a repeat-visit win is the Cache API copy of the pinned catalog rather than the network cache.

## Production checks

These are the deploy-time checks that are not a performance comparison:

- **Asset hash.** `curl -s https://<deployment>/ | grep -o 'assets/[^"]*\.js'` must name the same content-hashed
  bundle the local production build wrote under `dist/assets/`. A different name means the deployment is serving a
  different build; the page title alone proves nothing.
- **Schema.** `npm run db:migrate` reads `.env.local` (or `BAB_ENV_FILE`), applies `db/schema.sql`, and prints
  `db/schema.sql applied` plus `tables present: actions, events, lobby_teams, lobbies, participants`. Point it at the
  deployed database; a missing table is an API failure waiting to happen.
- **Live smoke.** `cold-load --url https://<deployment> --runs 3` proves the deployed bundle, the pinned catalog and
  the first spin. `lobby-load --base https://<deployment> --players 8 --seconds 20` proves the deployed API and Neon
  under a full lobby. `league --players 2 --mode normal --base https://<deployment>` is the driven user-path smoke.
- Deployed lobbies are not removed by `cleanup`; run `npm run prune:lobbies` on that database.
