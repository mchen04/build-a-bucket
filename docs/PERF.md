# Database transfer and latency

Neon bills public network transfer. Production spent 4.1 GB of the 5 GB monthly allowance running `main`'s old lobby. This measures the shared league on a local Postgres replay, per seat-minute, warm and with the in-memory league cache disabled (the serverless worst case). Round 4 removes the full-league read from every poll: a poll now reads a compact slice keyed by lobby, stage and cursor, and the old `league` column is only a fallback.

## How it is measured

`control.mjs perf` starts a throwaway Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs`, so every query is measured at the socket and repeated load never reaches Neon. Journeys are driver-level, except the real-time run, which is the real client in a browser.

Per-seat-minute is response bytes divided by seats times minutes in the steady polling window (setup excluded). `BAB_DISABLE_LEAGUE_CACHE=1` turns off the in-memory league cache so every poll would read the old league JSON; the slice path does not use that cache, so warm and cold are the same for new lobbies. The local dev server is one long-lived process, so the warm case is an upper bound on production's hit rate.

## Round 4 storage

`computeLeagueFor` writes three additive tables at lock, next to the existing `league` column:

- `league_slices`: one row per lobby with the compact humans, full standings, clock counts, awards, play-in, series, champion and head-to-head.
- `league_slice_games`: one row per regular game with team indexes, scores, winner and a `friends` flag.
- `league_slice_checkpoints`: one row per regular stage and integer cursor with the visible game count and a flat `[team, wins, losses, ...]` partial-standings array.

A poll reads the meta row (only the columns the stage needs), one checkpoint row, and the games the view needs: the last 30 visible, every game of the caller's team, and the last 20 human-vs-human games. The view is assembled by the same `assembleLeagueView` used by the old full-league path, so the two paths cannot drift. `tests/league-slice.test.ts` compares the old and new views for three seeds, all three modes, every stage, seven cursors per stage and all eight seats plus a spectator; it also checks that no game past the cursor and no participant id appears in the view.

The old `league` column is still written. `loadLeague` reads the slice first and falls back to the old column when the slice is missing (a lobby locked before the migration, or a failed slice write). The code treats a missing table (`42P01`) as a fallback, so the schema can be applied before or after the deploy. Rollback: drop `league_slices`, `league_slice_games` and `league_slice_checkpoints`; the old column still holds every league. No production migration was run.

## Kept changes

1. **Slice storage and read path.** The cold league read drops from the full ~177 KB JSON to a ~2.0 KB slice (meta 0.86 KB, checkpoint 0.39 KB, games 0.74 KB). The cold reveal poll drops from 274.6 KB to 4.9 KB of response.
2. **Authorized probe on every poll.** The cheap probe now runs for every poll, not only `waiting=1`. An unchanged poll returns 204 after the probe; a clock-only change is answered from the probe plus the slice without re-reading participants.
3. **Compact waiting probe.** `waiting=1` (lobby, draw, building, preview, checkpoint, recap) uses the compact probe (1.2 KB) instead of the full probe (2.5 KB). The checkpoint per-seat-minute fell from 195.8 KB to 65.3 KB.
4. **Targeted maintenance events.** The maintenance refresh reads only events past the client cursor instead of the last 30 (5.4 KB → 0.2-0.4 KB).
5. **One season-start writer.** `computeLeagueFor` claims the lobby with `league_version = -1` before simulating, so concurrent polls no longer each write the slice. The setup request fell from ~2.4 MB to ~1.2 MB per lobby and the season-start thundering herd is gone.
6. **Freshness driver.** Driver seats now record their seat number, so the ready group records samples; the watcher interval is 500 ms.

## Per-seat-minute, 20-second runs (three runs, median [range])

| Journey | Warm | Cold (`BAB_DISABLE_LEAGUE_CACHE=1`) |
|---|---|---|
| wait-reveal | 294.6 KB [206.5-313.5] | 293.7 KB [243.5-299.9] |
| wait-checkpoint | 67.8 KB [55.2-70.6] | 65.3 KB [59.6-70.9] |
| wait-building | 100.9 KB [56.7-101.6] | 98.4 KB [93.5-101.6] |

The cold and warm numbers match: the slice path does not depend on the in-memory cache. The 8-second runs (three runs) gave warm reveal 230.6 KB [187.9-239.1], checkpoint 151.2 KB [137.6-169.2] and building 213.6 KB [207.3-216.3]; the short window overweights the cheap 204 polls, so the 20-second numbers are the projection basis.

## Cold reveal poll breakdown (20 seconds, 160 polls)

| Part | Response bytes |
|---|---|
| Probe (lobby + eight participants) | 2,531 |
| Slice meta (compact humans + clock) | 862 |
| Games slice | 741 |
| Checkpoint | 386 |
| Events | 382 |
| Clock | 169 |
| Cursor update | 103 |
| **Total** | **5,174** |

The measured steady response is 4.9 KB per poll; the request is about 4.5 KB, so the cold reveal poll is about 9.4 KB of DB transfer, under the 10 KB target. The old path read the 177 KB league JSON on every cold poll.

## Projection

Assumptions: 8 seats, 20 minutes per 8-seat lobby (160 seat-minutes), 17.5% waiting polls (the round 3 8-seat UI mix) and 82.5% reveal polls, 50.4 polls per seat-minute (80% visible at 1 s, 20% hidden at 5 s).

| Per 8-seat, 20-minute lobby | Before round 4 (warm) | Round 4 warm | Round 4 cold |
|---|---|---|---|
| Transfer | 64.2 MB | 40.8 MB | 40.6 MB |
| At 115 lobbies/month (calibrated) | 7.38 GB | 4.69 GB | 4.67 GB |
| Lobbies that fit 4 GB (5 GB with 20% headroom) | 62 | 98 | 98 |
| Lobbies that fit 5 GB | 77 | 123 | 123 |

The 20-second cold mix is 4.67 GB at 115 lobbies: under the 5 GB quota with about 7% headroom, but above the 4 GB headroom target. The 8-second mix (230.6 KB reveal, 151.2 KB waiting) projects 3.99 GB and meets 4 GB; the difference is the 204 share (30% in the short run, 12% in the 20-second run). The remaining gap is the probe: 2.53 KB of the 5.17 KB reveal poll. A delta response that sends only the new games, or a smaller probe, is the next lever; the slice read itself is already 2.0 KB.

Calibration: main's 4.1 GB at 4.4 KB per poll is 932,000 polls; at 403 polls per lobby-minute that is 38.5 lobby-hours, or about 115 twenty-minute 8-seat lobbies a month.

## Freshness

The reveal reached every seat at p95 **10-214 ms** (three runs), far inside 2 s. The ready group now records samples (28 per run): p95 **2.1-3.0 s**; the season start p95 **1.4-3.0 s**. The DB p95 is 4 ms; the API p95 is 2.5 s, so the delay is the local replay's season-start simulation and the seven concurrent watchers, not the database. The 2 s limit is met by the reveal and missed by ready/season in this local replay. The season-start claim removes the repeated slice writes; the remaining cost is one league simulation plus the slice write.

## Earlier comparisons (kept)

| Journey | Baseline 7874bbd | After the round 1 changes |
|---|---|---|
| league-normal | 72.34 MB | 4.87 MB |
| league-salary | 57.90 MB | 4.57 MB |
| league-squad | 76.94 MB | 8.02 MB |

Round 2: waiting polls fell 60-90% per seat-minute. Round 3: the build payload is read only while building or previewing (`e932ac6`), and the reveal poll fell 29% warm. The waiting probe (`b229f9f`) and the event cursor (`6481ec4`) remain in place.

## Reproducing

```
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 --journeys wait,freshness --modes normal --tag warm
BAB_DISABLE_LEAGUE_CACHE=1 node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 --journeys wait,freshness --modes normal --tag cold
npx vitest run tests/league-slice.test.ts tests/league-reveal.test.ts
```

Evidence: `meter-<tag>-<timestamp>.json`, `db-meter.jsonl`, `server.log`. The cluster is stopped at the end.
