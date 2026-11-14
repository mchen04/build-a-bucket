# Whole-stack performance

How fast the rebuild loads on a phone compared with the original, and how the lobby API and database behave with a full 8-player lobby.

## Sub-features

- `perf-cold` cold-load FCP, LCP, TTI-ish, `firstSpinMs`, bytes, requests, heap and long tasks under the original's baseline conditions, for the first visit and (with `--visits 2`) the repeat visit in the same context.
- `perf-lobby` p50/p95 per lobby endpoint with 8 players polling and syncing drafts, plus over-capacity joins, poll shape (full view / delta / 204) and bytes per poll.
- `perf-db` the same workload against dev, preview and production to separate database and function time.

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
