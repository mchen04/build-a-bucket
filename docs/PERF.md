# Database transfer and latency

This is one current account. Everything below is **local wire-protocol instrumentation** on a throwaway Postgres, not Neon billed egress. Raw meters are preserved at `evidence/perf/meter-*.json`.

## Method

`control.mjs perf` starts a throwaway Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs`, so every query is measured at the socket. The season journey drives all ten stage phases through the API with a controlled clock, one full and occasional no-change poll per seat per tick, and completes in about 12 s. Each run makes 5,058 API calls. Three runs per tree; the figure per tree is the sum over the `season-*` phases of each run's phase median, then the median across the three runs. Totals that combine two fields add them per run first, then take the median, so no row mixes phases or runs.

The figures are bytes on the local Postgres socket and the local HTTP connection. They are proportional to what production transfers, but they are not Neon's billed transfer, and no quota fit is claimed from them.

## Final base → rm

`base` is the pre-change tree measured in this round; `rm` is the shipped tree. Recomputed from `evidence/perf/meter-{base,rm}-{1,2,3}-*.json` by `.claude/skills/verify-build-a-bucket/scripts/meter/recompute.mjs <dir>`:

| Per 5,058-call season run | base | rm | Change |
|---|---|---|---|
| DB response bytes | 50,577,343 | 19,890,910 | −60.7% |
| DB request bytes | 17,336,253 | 13,361,129 | −22.9% |
| DB request + response bytes | 68,019,022 | 33,227,344 | −51.1% |
| DB requests | 31,666 | 23,824 | −24.8% |
| API/browser response bytes | 96,573,714 | 22,138,661 | −77.1% |

Per-run values are in the recompute output (`requestPlusResponse` is the per-run sum); no run overlaps another's range in the direction of the change.

## Kept changes

1. **Slice storage and read path.** `computeLeagueFor` writes `league_slices`, `league_slice_games` and `league_slice_checkpoints`; a poll reads a compact slice instead of the full ~177 KB league JSON. The cold reveal poll fell from 274.6 KB to 4.9 KB of response.
2. **Always-probe plus clock path.** The authorized probe runs on every poll; an unchanged poll returns 204. The waiting probe is compact (1.2 KB instead of 2.5 KB).
3. **Targeted maintenance events.** The refresh reads only events past the client cursor (5.4 KB → 0.2-0.4 KB).
4. **One season-start writer.** `computeLeagueFor` claims the lobby with `league_version = -1`; the setup request fell from ~2.4 MB to ~1.2 MB per lobby and concurrent polls no longer each write the slice.
5. **Series filter and the advance clock.** The meta read returns only the current round's series, and `advanceLobby` reads `league_slices.clock` (107 B) instead of the 177 KB column.
6. **League delta.** A reveal poll sends only the games past the client cursor plus the changed partial standings; the client merges them. `tests/league-slice.test.ts` reproduces the full view from a delta for every stage, four cursor pairs and all eight seats.
7. **Reveal cadence.** Visible reveal polls moved from 1 s to 1.5 s; the real run's poll count fell from 6,057 to 4,394 (27%).
8. **Revealed series only and compact regular standings.** `SERIES_READ` keeps only cursor-revealed games; regular standings travel as `[teamIndex, wins, losses, seed]` rows.

## Rejected

- **Query combination.** The Neon calibration shows about 120 B of fixed HTTP body overhead per query, so folding the poll's six queries into one saves little.
- **2 s reveal cadence.** Not needed; 1.5 s keeps the ready p95 at one watcher interval.
- **Compact probe cut.** The probe is a large share of the response, but the fixed per-query overhead limits the gain.
- **Series delta.** Not implemented; the playoff meta is still read per round.

## Earlier compressed-fixture runs (rounds 4-6)

These are per-season replay totals from the rounds before the final tree, kept for the comparison they supported, not as current numbers. Round 4 fetch harness: wait-reveal 294.6 KB/seat-minute warm and 293.7 cold, wait-checkpoint 67.8 / 65.3, wait-building 100.9 / 98.4 (three 20-second runs). The 8-second runs underweighted the cheap 204 polls and are not used. Round 5 baseline 49,056.9 KB response / 15,708.8 KB request over 84.43 seat-minutes (581.0 / 186.0 KB/seat-minute); the delta replay was 24,757 KB [24,051-25,246], the revealed-series replay 21,962 KB [21,922-22,484], and the compact-regular-standings replay 19,425 KB [19,339-20,405]. One baseline had a `delta2-4` outlier (API p95 65 ms) with no effect on the totals used.

## Timed journeys

The 8-seat browser journey was run at each head, once per head, against the local stack. At `971ca19` the season window was 640.8 s (85.44 seat-minutes), response 10,383.7 KB and request 7,609.9 KB, **121.5 KB/seat-minute response and 89.1 request**. At `20d53e3` the same journey was 175.3 / 112.6. At `dfc37cb` it was 598.5 / 195.6. Phase durations at `971ca19`: first quarter 122 s, second 127 s, third 124 s, fourth 1 s, awards 1 s, Play-In 69 s, first round 27 s, semifinals 21 s, conference finals 9 s, Finals 2 s; the season, recap and Play Again completed. Each of these runs logged one 409 on seat 1; the season continued to the recap (see `evidence-r4/` for the current-head trace of that duplicate).

## Latency

Two timed freshness runs are preserved; both are three runs of 8 seats.

| Raw file | Watcher gap | Ready p95 | Reveal p95 | Season start p95 | API p95 | DB p95 |
|---|---|---|---|---|---|---|
| `meter-fresh15-*` | 1.5 s | 1,515 ms (runs 1,513 / 1,515 / 1,522) | not sampled (poll gap hides it) | 4-5 ms | 21 ms | 3 ms |
| `meter-head-http-*` | 0.5 s | 519 ms (runs 519 / 518 / 510) | 9-16 ms | 1,517-1,522 ms | 15 ms | 3-4 ms |

The ready p95 tracks the watcher interval, so the 1.5 s figure is the cadence, not the server. The 2 s limit holds in both. The earlier 2.0-3.0 s ready p95 (`meter-head-cache-*`, `meter-r4-20-warm-*`) was the Node `fetch` pool, not the app: the server handlers were under 50 ms and the DB p95 was 3-5 ms. The 500 ms-watcher table that compared a second head is not in the preserved meters, so it is not reproduced here.

## One Neon calibration

One short journey against the Neon dev branch moved a `fullResults` body of 4.03 MB, about 2.8 MB of true HTTP body; the client-side type object is not part of the response. Per query, Neon body to local wire was: clock 1.63, checkpoint 1.21, games 1.08, regular meta 2.15, compact probe 1.98, `select 1` 170 B. The weighted ratio for the round 5 mix was 1.63 and for the round 6 phase mix 1.32. This is a body-size calibration between two transports, not billed egress, and it is not used below.

## One hypothetical monthly workload

**Hypothetical, not measured.** If 100 eight-seat, 20-minute lobbies (160 seat-minutes each) ran in a month on this code path, the 8-seat timed journey at `971ca19` implies 121.5 KB of DB response and 89.1 KB of DB request per seat-minute, so 19.4 MB of response and 14.3 MB of request per lobby, and about 1.94 GB of response and 3.37 GB of request+response for the month. No user volume is assumed here; this is arithmetic on that journey's measured per-seat-minute numbers, not on the season replay above.

## Limitation

Billed production savings are **not measured**. The old project's production branch used 94 MB of transfer in the last billing period; real user lobby volume is unknown, so that number cannot be converted into lobbies or into a saving. The new project's transfer counter lags and cannot be quoted as zero. A production comparison would need comparable observed windows under comparable load, which this round did not have.

## Reproducing

```
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --out <dir> --runs 3 --journeys season --modes normal --tag season
BAB_DISABLE_LEAGUE_CACHE=1 node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 --journeys wait,freshness --modes normal --tag cold
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --out <dir> --runs 3 --journeys freshness --fresh-gap 1500 --modes normal --tag fresh15
```

The 8-seat UI run needs the local meter env on a `launch` and then `control.mjs league --players 8 --mode normal` (about 13 minutes of wall clock). DB-backed tests and the driver must use the local cluster: `npm run test:local-db`, `npm run e2e:local-db`, `control.mjs launch` (local by default). Evidence: `meter-<tag>-<timestamp>.json`, `ui-db-meter*.jsonl`, `db-meter.jsonl`, `server.log`.
