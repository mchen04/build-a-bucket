# Database transfer and latency

Neon bills public network transfer, not storage. This is the measured database cost of the shared league and the two changes that cut it, on a local Postgres replay so repeated load never reached Neon.

## How it was measured

`node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20` starts a throwaway Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs` (Postgres wire protocol, installed only when `BAB_DB_RUNNER` is set). Every query is measured at the socket: request and response bytes are Postgres wire bytes (framing included, TCP/IP headers excluded), and latency is the localhost round trip. API bytes are the JSON the browser receives; the static payload is the dev `index.html` (the production bundle is covered by `cold-load`).

Journeys: `solo` (Play and Daily, zero database requests), `idle-lobby` (eight seats polling every second for 20 s), and `league-<mode>` (eight players through draw, lock, auto-completed builds, preview, every checkpoint, awards, play-in, playoffs, recap, a mid-season reload of seat 4, and Play Again into the second season). The reveal is compressed by backdating `stage_started_at` in the local database between polls; per-poll request and response shape is unchanged.

Conditions: this Mac, local Postgres 14, `fsync=off`, one run at a time, three runs per side. Medians with min-max ranges.

## Before and after

Baseline is `7874bbd` in a detached worktree plus the measurement seam only. `league-cache` is `efa879f`; `event-cursor` is `6481ec4`.

| Journey | Baseline DB bytes | After DB bytes | Baseline per poll | After per poll | Baseline p95 | After p95 |
|---|---|---|---|---|---|---|
| solo | 0 | 0 | n/a | n/a | n/a | n/a |
| idle-lobby (20 s) | 654.0 KB [414.7-864.5] | 550.3 KB [550.2-610.9] | 5.5 KB | 4.0 KB | 4 ms | 4 ms |
| league-normal | 72.34 MB [51.71-95.53] | 4.87 MB [4.07-4.95] | 302.4 KB | 19.3 KB | 14 ms | 4 ms |
| league-salary | 57.90 MB [53.79-63.36] | 4.57 MB [3.98-4.65] | 309.1 KB | 19.4 KB | 14 ms | 4 ms |
| league-squad | 76.94 MB [72.91-87.16] | 8.02 MB [7.84-10.57] | 321.9 KB | 38.2 KB | 10 ms | 4 ms |

Database requests per league journey are unchanged (about 950-1,020); the bytes per request fell. API bytes to the browser are unchanged within run-to-run range (normal 7.56 → 8.05 MB, salary 5.89 → 6.97 MB, squad 12.70 → 11.25 MB); the poll count varies with how many checkpoints the driver reaches, not with these changes.

`main` at `28c0d2f` (the old parallel-season lobby) has no shared league, so only the journeys that exist there were run: `solo` 0 bytes, `idle-lobby` 489.8 KB [489.0-522.9] at 4.4 KB per poll, p95 4 ms. The branch's idle lobby is 4.0 KB per poll, slightly below main.

## What changed

1. **`efa879f` Cache the immutable league JSON instead of reading it on every poll.** The poll query selected `lobbies.league` (about 150 KB) on every request, including the 204 and delta paths that never use it. In the baseline it was 64.2 MB of 65.1 MB of database response bytes. The league is written once per game, so `lobbies.league_version` (additive migration) now identifies it and the server keeps the parsed league in a 32-entry in-memory cache, reading the column only on a miss. Rollback: drop the column and restore `'league', l.league` in `READ_SQL`; the cache is inert without the column.
2. **`6481ec4` Read only events past the client cursor on poll.** The poll query always read the last 40 events (about 10 KB) even when the client already had them. It now reads events with `id > $3` plus the latest event id (so the progress token still matches and unchanged polls still answer 204). Full views (`events=0`) are unchanged.

## Rejected

- **Read only a build-presence flag in `autoCompleteMissing`.** The query dropped from 2.5 MB to below 1.7 MB over three runs, but journey medians were normal 4.99 MB [4.79-5.87] (worse), salary 3.66 MB [3.54-4.60] (better), squad 9.30 MB [9.26-10.15] (worse), all overlapping the kept change's ranges. Reverted; the rule was a clear gain outside the run-to-run range.
- **Skip the poll read entirely when the version is unchanged.** Not attempted: the progress token needs the reveal cursor and participant progress, so a cheap probe would have to reproduce the view's token exactly. The remaining per-poll bytes are about 19 KB (normal/salary) and 38 KB (squad), mostly participant rows and the caller's own build.

Threshold used to stop: the next candidate had to beat the current median by more than 10% per journey (about 0.5 MB normal/salary, 0.8 MB squad) outside the run-to-run range. The remaining candidates were below that or too risky for freshness.

## Projection

Assumptions, stated plainly because production counts were not available: 1,000 shared-league games per month, 8 seats each, one full journey per game, mix 60% normal / 20% salary / 20% squad.

| | Per game | Per month at 1,000 games | Games the 5 GB quota allows |
|---|---|---|---|
| Baseline | 70.4 MB | 70.4 GB | about 71 |
| After | 5.43 MB | 5.43 GB | about 920 |

That is a 92% cut in database transfer for the shared league. The 4.1 GB already spent came from `main`'s old lobby, whose idle polling costs 4.4 KB per poll; at that rate 4.1 GB is about 932,000 polls, or 32 lobby-hours of eight seats polling every second. The new league would have cost far more per game before these changes, which is why the league JSON read was the first target.

## Reproducing

```
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 --tag after
```

Evidence: `meter-<tag>-<timestamp>.json` (aggregate and every run), `db-meter.jsonl` (raw per-query log), `server.log`. The cluster is stopped at the end. The baseline worktree is `git worktree add --detach /tmp/bab-base-7874bbd 7874bbd` plus the seam commit, with `node_modules` symlinked.
