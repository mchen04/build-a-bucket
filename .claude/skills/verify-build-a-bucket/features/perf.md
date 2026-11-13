# Whole-stack performance

How fast the rebuild loads on a phone compared with the original, and how the lobby API and database behave with a full 8-player lobby.

## Sub-features

- `perf-cold` cold-load FCP, LCP, TTI-ish, bytes, requests, heap and long tasks under the original's baseline conditions.
- `perf-lobby` p50/p95 per lobby endpoint with 8 players polling and syncing drafts, plus over-capacity joins.
- `perf-db` the same workload against dev, preview and production to separate database and function time.

## How to get to it (user POV)

- A player opening the home page on a phone network; eight friends in one lobby.

## Driving it with control.mjs

Preconditions:

- Machine load noted (`uptime`); nothing else heavy started during a comparison.

- **Rebuild cold load.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs launch --prod`, then `node .claude/skills/verify-build-a-bucket/scripts/control.mjs cold-load --runs 5`. Medians land in `evidence/perf/cold-load-*.json`.
- **Original cold load.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs cold-load --runs 5 --url https://build-a-player.com/bucket` in the same session; interleave with the rebuild when comparing.
- **Lobby, dev.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs launch`, then `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --players 8 --extra 4 --seconds 20`.
- **Lobby, deployed.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --base https://<deployment> --players 8 --seconds 20`. Its lobbies stay in that database until `npm run prune:lobbies`.
- **Reading it.** A lower median outside the other side's min-max range is a gain; overlapping ranges are "no measured gain". Poll 204 share near 100% means version churn is low.

## Gotchas

- The dev server compiles modules on first request; warm it with one `ui` run before timing, or time against `--prod`/a deployment.
- `cold-load` against `launch` in dev mode measures unbundled modules; never compare it with a production build.
- Draft syncs bump the lobby version, so peers' polls return full views while anyone is building.
