# Database transfer and latency

Neon bills public network transfer. Production spent 4.1 GB of the 5 GB monthly allowance running `main`'s old lobby. This measures the shared league on a local Postgres replay, per seat-minute, warm and with the in-memory league cache disabled (the serverless worst case), and covers the reveal poll that now dominates.

## How it is measured

`control.mjs perf` starts a throwaway Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs`, so every query is measured at the socket and repeated load never reaches Neon. Journeys are driver-level, except the real-time run, which is the real client in a browser.

Per-seat-minute is response bytes divided by seats times minutes in the steady polling window (setup excluded). `BAB_DISABLE_LEAGUE_CACHE=1` turns off the in-memory league cache so every poll reads the league JSON; that is the worst case for a cold serverless instance. The local dev server is one long-lived process, so the warm case is an upper bound on production's hit rate.

## Real-time runs

| Run | Seats | Minutes | Seat-minutes | Full reads | Waiting probes | Response per seat-minute |
|---|---|---|---|---|---|---|
| Round 2 | 2 | 11.4 | 22.8 | 1,303 | 77 (5.6%) | 561 KB |
| Round 3 (8 seats) | 8 | 12.7 | 101.5 | 5,220 | 1,104 (17.5%) | 320 KB |

Eight seats wait more than two: 17.5% of polls were waiting polls at a checkpoint or in the lobby/build phases. The round 3 run completed a full season, playoffs, recap and Play Again with cross-seat standings checks on every checkpoint.

Phase durations (8-seat run): first quarter 121 s, second 126 s, third 123 s, fourth 1 s, awards 1 s, Play-In 69 s, playoffs 37/16/7/1 s, recap. The game is reveal-dominated.

## Reveal poll breakdown (8 seats, normal, warm, with the client's event cursor)

| Part | Wire bytes | Share |
|---|---|---|
| Full poll response | 6,821 | 100% |
| Caller's `build` | 2,352 | 34% |
| `build_summary` (8 seats) | 616 | 9% |
| Lobby row | 618 | 9% |
| Events (one, the client's cursor) | 160 | 2% |
| Participants base fields | 3,075 | 45% |
| `salary_powers` (normal mode) | 0 | 0% |
| Full poll request (SQL text) | 2,109 | |

`salary_powers` is caller-only and non-zero in salary mode. The two biggest parts are the caller's build payload and the eight participant rows.

## Kept change: read build payloads only while building or previewing

`e932ac6` adds `and (select phase from l) in ('building', 'preview')` to the `build` and `salary_powers` columns. The client uses `buildSeed`, not the stored build, and only the builder screens need these payloads. A reveal poll drops from 6,821 to 4,469 bytes of response and from 2,109 to 1,873 bytes of request, a 29% cut per poll.

Warm (median [range], three runs):

| Journey | Before cf94ee7 | After e932ac6 | Change |
|---|---|---|---|
| wait-reveal, per poll | 15.2 KB | 12.2 KB | -20% |
| wait-reveal, per seat-minute | 590.4 KB [513.3-740.6] | 427.5 KB [357.6-516.6] | -28% |
| league-normal journey | 4.71 MB [4.05-5.73] | 3.72 MB [3.45-3.80] | -21% |
| wait-checkpoint, per seat-minute | 30.6 KB [25.4-279.5] | 40.8 KB [40.3-43.1] | no change (probe path, not affected) |
| wait-building, per seat-minute | 93.6 KB | 98.4 KB | no change (build payload still read) |

Cold cache (`BAB_DISABLE_LEAGUE_CACHE=1`, three runs):

| Journey | Before | After | Change |
|---|---|---|---|
| wait-reveal, per poll | 290.4 KB | 274.6 KB | -5% |
| wait-reveal, per seat-minute | 17.4 MB [17.05-17.71] | 16.5 MB [16.06-16.64] | -5% |
| league-normal journey | 104.5 MB [87.9-107.4] | 98.8 MB [96.8-98.9] | -5% (median inside the before range: weak) |
| wait-checkpoint, per seat-minute | 11.35 MB | 10.77 MB | -5% |

The cold case is dominated by the ~268 KB league JSON read on every poll, so removing 2.3 KB of build payload is only a 5% cut. This change is proven with a warm cache; cold, its gain is close to noise.

## Rejected and not attempted

- **Clock-only delta (skip the participants read when only the stage clock moved).** Not attempted. It needs a `participants_version` column, a delta that carries the league view, and a client merge; it is the next change, not this round's. It would cut a reveal poll from 4,469 to about 600 bytes because the participants base fields are 45% of the response.
- **Shorter SQL text or a prepared shape.** Not attempted. The Neon HTTP driver is stateless, so the SQL text is resent on every request; shortening it is a 2 KB-per-poll lever, smaller than the response.
- **Matching the poll interval to the 1.2 s reveal cadence.** Not attempted. A longer reveal interval risks the 2 s freshness limit for peer actions and the checkpoint advance; the reveal already costs 12.2 KB per poll, so the interval is a second-order lever.

## Freshness

The reveal reached every seat at p95 **17-58 ms** (three runs), far inside 2 s. The season start (the one-time league simulation and its propagation) measured p95 1,552 / 1,950 / 2,027 ms, at the 2 s boundary because it includes the simulation, not polling. The driver's ready-propagation group produced no samples in these runs (the preview-phase ready flip was not observed within 5 s by the watchers); peer actions are covered instead by the focused API tests (204, delta, stale token, removed player, checkpoint advance, reveal clock) and by the 8-seat UI run's cross-seat standings checks.

## Projection

Assumptions: 8 seats, 20 minutes per 8-seat lobby (160 seat-minutes), 17.5% waiting polls (the 8-seat UI mix) and 82.5% reveal polls, 50.4 polls per seat-minute (80% visible at 1 s, 20% hidden at 5 s).

Warm per-seat-minute: reveal 590.4 before → 427.5 after; waiting 400 before → 70 after.

| Per 8-seat, 20-minute lobby | Before | After |
|---|---|---|
| Transfer | 89.1 MB | 58.1 MB |
| At 115 lobbies/month (calibrated) | 10.2 GB | 6.7 GB |
| Lobbies that fit 4 GB (5 GB with 20% headroom) | 45 | 69 |

Calibration: main's 4.1 GB at 4.4 KB per poll is 932,000 polls; at 403 polls per lobby-minute that is 38.5 lobby-hours, or about 115 twenty-minute 8-seat lobbies a month. Change A is not enough at that volume: 6.7 GB still exceeds 5 GB, and 20% headroom fits about 69 lobbies. The clock-only delta is the change that would bring 115 lobbies to about 1.5 GB.

Cold cache (every poll reads the 268 KB league JSON): 15.35 MB per seat-minute, 2.46 GB per lobby, 283 GB at 115 lobbies. The volume that fits 4 GB cold is about 1.6 lobbies a month. The in-memory cache is existential for production; the warm projection is the realistic one only while instances stay warm.

## Earlier comparisons (kept)

| Journey | Baseline 7874bbd | After the round 1 changes |
|---|---|---|
| league-normal | 72.34 MB | 4.87 MB |
| league-salary | 57.90 MB | 4.57 MB |
| league-squad | 76.94 MB | 8.02 MB |

Round 2: waiting polls fell 60-90% per seat-minute; the round 2 doc retains the full table. The waiting probe (`b229f9f`) and the event cursor (`6481ec4`) remain in place.

## Reproducing

```
BAB_DISABLE_LEAGUE_CACHE=1 node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 --journeys idle,wait,freshness,league --modes normal --tag cold
node .claude/skills/verify-build-a-bucket/scripts/control.mjs league --players 8 --base http://127.0.0.1:<port>
```

Evidence: `meter-<tag>-<timestamp>.json`, `db-meter.jsonl`, `server.log`; the 8-seat run's `summary.json` holds `phaseTimings`. The cluster is stopped at the end.
