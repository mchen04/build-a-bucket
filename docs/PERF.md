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

| Per 8-seat, 20-minute lobby | Before round 4 (warm) | Round 4 warm | Round 4 cold | Round 5 cold (HTTP stage 0) | 8-seat real-time |
|---|---|---|---|---|---|
| Transfer | 64.2 MB | 40.8 MB | 40.6 MB | 42.5 MB | 95.8 MB |
| At 115 lobbies/month (calibrated) | 7.38 GB | 4.69 GB | 4.67 GB | 4.89 GB | 11.01 GB |
| Lobbies that fit 4 GB (5 GB with 20% headroom) | 62 | 98 | 98 | 94 | 41 |
| Lobbies that fit 5 GB | 77 | 123 | 123 | 117 | 52 |

The round 5 cold mix is 4.89 GB at 115 lobbies: under the 5 GB quota with about 2% headroom, but above the 4 GB headroom target. The HTTP harness completes the intended 160 polls per 20 seconds; the fetch harness's slow polls undercounted the poll count, so the round 4 cold 4.67 GB is not directly comparable. The per-poll cold reveal is 5.08 KB (304.9 KB/seat-minute over 160 polls); the request is about 4.5 KB, so the cold reveal poll is about 9.6 KB, under the 10 KB target. The remaining gap is the probe: 2.53 KB of the 5.17 KB reveal poll. A delta response that sends only the new games, or a smaller probe, is the next lever; the slice read itself is already 2.0 KB.

## Eight-seat real-time run

The 8-seat UI run at dfc37cb completed a full season, Play-In, playoffs, recap and Play Again. Phase durations: first quarter 121 s, second 126 s, third 124 s, fourth 2 s, awards 2 s, Play-In 70 s, first round 31 s, semifinals 19 s, conference finals 12 s, Finals 1 s. The season window was 10.6 minutes; the DB response was 598.5 KB/seat-minute and the request 195.6 KB/seat-minute, 794.1 KB total. The full-season mix is about twice the stage-0 wait journey because the later stages carry larger game lists. At 115 lobbies the response projection is 11.01 GB and the total 14.61 GB: the 5 GB quota is not met (52 lobbies fit 5 GB, 41 fit 4 GB). The run recorded one 409 on seat 1, a duplicate action; the season, recap and Play Again completed.

## Bundled changes

- Slice storage: cold reveal 274.6 KB → 4.9 KB (round 4).
- Compact waiting probe: checkpoint 195.8 → 65.3 KB/seat-minute (round 4 fetch); the HTTP harness 80.9 with 160 polls.
- Targeted events: maintenance event read 5.4 KB → 0.2-0.4 KB.
- Season-start claim: setup request 2.4 → 1.2 MB; the season p95 is 1.52 s at both trees.
- Always-probe + clock path: the no-probe variant (full read on every reveal poll) is 528.9 KB/seat-minute; the no-clock variant (probe + full read) is 660.8; the head is 304.9. The clock path alone cuts 355.9 KB/seat-minute (54%) vs no-clock; the combined always-probe + clock path cuts 224.0 KB/seat-minute (42%) vs no-probe. The no-clock is higher than no-probe because the probe is paid on every full poll; the 204 fast path does not offset it. One run each; the head is three runs.

## Playwright

The three failures were stale tests, not app regressions. The home screen now has Quick Play toggles and a separate Play button; the tests use the new test ids. The roster renders open seats as rows; the test counts only rows with a seat. The saved Daily salary result is the rich revisitable locked result ("TODAY IS LOCKED IN", the outcome and the stats); the test expected the old "PREVIEW" line. The lobby spec also needed the auto-lock, auto-preview, rematch-ready and fast-forward version bump. The full suite is 15 passed, 2 skipped (the daily challenge skip on both projects), 0 failed. The 2-player lobby spec overlaps the league driver's full-season flow but is the only Playwright coverage of the home join-by-code and the 2-player roster; it is kept, and the 8-player matrix will cover the overlap.

Calibration: main's 4.1 GB at 4.4 KB per poll is 932,000 polls; at 403 polls per lobby-minute that is 38.5 lobby-hours, or about 115 twenty-minute 8-seat lobbies a month.

## Freshness

The round 4 ready p95 of 2.1-3.0 s was the Node `fetch` pool, not the app. The server handlers were under 50 ms (the `api-phase` logs) and the DB p95 was 3-5 ms; the seven watchers shared the fetch pool. Driving the harness through a 64-socket HTTP agent and caching the dev server's API module load gives:

| Run, three runs | Ready p95 | Season p95 | Reveal p95 | API p95 | DB p95 |
|---|---|---|---|---|---|
| 5eca20f | 520-525 ms | 1517-1542 ms | 8-16 ms | 20 ms | 5-6 ms |
| head dfc37cb | 510-519 ms | 1517-1522 ms | 9-16 ms | 15 ms | 3-4 ms |

The head is not worse; both are under 2 s. The ready p95 is the 500 ms watcher interval plus the server; the season p95 is the one league simulation and slice write. The old fetch harness measured 2.5-3.0 s at both trees; the difference is the harness, not the app. The DB transfer is unchanged because the HTTP driver sends the same requests.

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
