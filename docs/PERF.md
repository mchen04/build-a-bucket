# Database transfer and latency

Neon bills public network transfer. The project used 5.57 GB of its 5 GB monthly allowance for Nov 1–Dec 1: the dev branch used 5.48 GB and production `main` 94 MB. Almost all of the dev usage was our own testing, not users; the 4.1 GB figure in the earlier Neon email was also mostly testing. This measures the shared league on a local Postgres replay, per seat-minute, warm and with the in-memory league cache disabled (the serverless worst case). Round 4 removes the full-league read from every poll: a poll now reads a compact slice keyed by lobby, stage and cursor, and the old `league` column is only a fallback.

## How it is measured

`control.mjs perf` starts a throwaway Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs`, so every query is measured at the socket and repeated load never reaches Neon. Journeys are driver-level, except the real-time run, which is the real client in a browser.

Per-seat-minute is response bytes divided by seats times minutes in the steady polling window (setup excluded). `BAB_DISABLE_LEAGUE_CACHE=1` turns off the in-memory league cache so every poll would read the old league JSON; the slice path does not use that cache, so warm and cold are the same for new lobbies. The local dev server is one long-lived process, so the warm case is an upper bound on production's hit rate.

## Production calibration (Nov 1–Dec 1)

The Neon project used 5.57 GB this period: dev 5.48 GB and production main 94 MB. The dev branch is our test
traffic, not customer load. Production main's 94 MB is about 1.25 8-seat 20-minute lobbies at the 75.0 MB
Neon-calibrated per-lobby transfer below (about 2.3 if only the 45.7 MB response is counted). The earlier 4.1 GB
email and the 120.5-lobby projection derived from it are withdrawn: that usage was mostly testing.

Every DB-backed test and the 8-player driver must use a throwaway local Postgres. `npm run test:local-db` and
`npm run e2e:local-db` start, seed, run and stop one cluster; `control.mjs launch` defaults to a local cluster and
`control.mjs launch --neon` is the only opt-in to the dev branch. Never point tests at the production project's
database.

## Round 4 storage

`computeLeagueFor` writes three additive tables at lock, next to the existing `league` column:

- `league_slices`: one row per lobby with the compact humans, full standings, clock counts, awards, play-in, series, champion and head-to-head.
- `league_slice_games`: one row per regular game with team indexes, scores, winner and a `friends` flag.
- `league_slice_checkpoints`: one row per regular stage and integer cursor with the visible game count and a flat `[team, wins, losses, ...]` partial-standings array.

A poll reads the meta row (only the columns the stage needs), one checkpoint row, and the games the view needs: the last 30 visible, every game of the caller's team, and the last 20 human-vs-human games. The view is assembled by the same `assembleLeagueView` used by the old full-league path, so the two paths cannot drift. `tests/league-slice.test.ts` compares the old and new views for three seeds, all three modes, every stage, seven cursors per stage and all eight seats plus a spectator; it also checks that no game past the cursor and no participant id appears in the view.

The old `league` column is still written. `loadLeague` reads the slice first and falls back to the old column when the slice is missing (a lobby locked before the migration, or a failed slice write). The code treats a missing table (`42P01`) as a fallback, but the season-start claim needs `lobbies.league_claimed_at`, so apply `db/schema.sql` immediately before the deploy. The legacy normalisation only touches rows created before the `locked_at` column existed, so every later `scripts/migrate.ts` rerun leaves live building, preview, season, playoff and rematch lobbies unchanged. Rollback: normalise `status = 'ready'` before applying `main`'s schema, then drop the slice tables if desired; the old column still holds every league. See `docs/ROLLBACK.md`.

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

## Round 5 full season

The round 5 baseline is the same 8-seat UI season at 20d53e3's parent: 49,056.9 KB of response and 15,708.8 KB of request over 84.43 seat-minutes (581.0 and 186.0 KB/seat-minute). The breakdown by query:

| Query | Calls | Response KB | Per call |
|---|---|---|---|
| meta | 4,459 | 15,953.7 | 3,664 |
| games | 4,459 | 14,809.6 | 3,401 |
| probe | 6,057 | 13,102.3 | 2,215 |
| read | 322 | 2,153.8 | 6,849 |
| advance-league | 11 | 1,734.1 | 161,431 |
| checkpoint | 3,593 | 1,514.4 | 432 |
| events | 4,294 | 925.7 | 216 |
| clock | 5,029 | 830.0 | 169 |

The largest cell was the playoff meta: 606 calls at 15,708 B in the first two rounds, because the meta row carried the full four-round series (10.9 KB), the full humans (2.5 KB), the standings, awards and Play-In on every poll. The games read re-read the last 30 games, every game of the caller's team and the last 20 human-vs-human games on every poll. The advance handler read the 177 KB `league` column to get the clock.

### Kept changes

1. **Series filter.** The meta read returns only the series for the current round (`round <= stage - 5`). The replay's first-round meta fell from 11,265 KB to 9,359 KB in one run; the three-run medians for the series filter plus the advance fix are 49,392 KB [49,249-50,519] before and 46,799 KB [45,357-46,832] after, a 2,593 KB (5.2%) gain beyond the run-to-run range.
2. **Advance clock from the slice.** `advanceLobby` reads `league_slices.clock` (107 B) instead of the 177 KB `league` column, with the old column as the fallback. Eleven advances per season save 1.7 MB.
3. **League delta.** A reveal poll now sends only the games past the client's cursor and the changed standings; the client merges them into their view. The server reads the new games only (`game_no > sinceCursor`), the checkpoint for the partial standings, and the current round's series. The client sends `cursor` and `stage`; a poll without them falls back to the full clock view. `tests/league-slice.test.ts` merges a delta into the previous view for every stage, four cursor pairs and all eight seats and compares it to the full view. The four delta replays are 24,757 KB [24,051-25,246] per compressed season, 49.9% below the 49,392 KB baseline.
4. **Reveal cadence.** Visible reveal polls moved from 1 s to 1.5 s, matching the 1.2 s regular and 1.5 s playoff reveal cadence; checkpoint and recap polls stay at 1 s. The real run's poll count fell from 6,057 to 4,394 (27%). Peer-action propagation is bounded by the 1.5 s poll interval plus the server, under the 2 s p95 limit.

### Rejected

- **Query combination.** The Neon calibration shows a ~120 B fixed HTTP body overhead per query, not the ~1 KB the client-side `fullTypes` object suggested, so folding the poll's six queries into one saves little.
- **2 s reveal cadence.** Not needed: 1.5 s already meets the local 4 GB target and keeps the reveal matched to the cadence.
- **Series delta.** Not implemented. The playoff meta is still 8.1 MB of the 14.7 MB final run (55%); sending only the newly revealed series games is the next lever.

### Final 8-seat real-time run (20d53e3)

The season window was 630.6 s (84.08 seat-minutes); the response was 14,736.3 KB and the request 9,464.3 KB, **175.3 KB/seat-minute response and 112.6 request**, down 70.7% from 581.0. Phase durations: first quarter 122 s, second 127 s, third 124 s, fourth 1 s, awards 1 s, Play-In 69 s, first round 27 s, semifinals 21 s, conference finals 9 s, Finals 2 s. The season, recap and Play Again completed; one 409 on seat 1 was a duplicate action.

| Query | Calls | Response KB | Per call |
|---|---|---|---|
| meta | 3,444 | 8,111.3 | 2,412 |
| probe | 4,394 | 3,247.6 | 757 |
| read | 323 | 2,181.3 | 6,915 |
| games | 2,805 | 1,265.0 | 462 |
| checkpoint | 2,691 | 1,134.1 | 432 |
| clock | 3,382 | 558.2 | 169 |
| clock-write | 642 | 65.4 | 104 |
| events | 11 | 38.9 | 3,620 |

By phase: regular-0 3,424.3 KB, regular-1 1,748.9, regular-2 1,821.7, regular-3 1,803.4, awards 277.2, Play-In 326.5, first round 2,788.1, semifinals 1,634.5, conference finals 1,562.2, Finals 992.9, recap 380.3. The playoff meta is 6,112-10,623 B per call because the series is still read whole for the current round.

### Neon calibration

The Neon dev branch received the additive schema (48 statements) and one short 8-seat journey: create, join, start, draw, lock, advance and 12 rounds of eight delta polls. The journey moved 4.03 MB of `fullResults` JSON, about 2.8 MB of true HTTP body. The client-side `_types`/`_parsers` object is not part of the response; the true body is `{fields, rows, command, rowCount}`.

| Query | Neon body | Local wire | Ratio |
|---|---|---|---|
| `select 1` | 170 B | — | — |
| clock | 276 B | 169 B | 1.63 |
| checkpoint | 522 B | 432 B | 1.21 |
| games (3) | ~500 B | 462 B | 1.08 |
| meta (regular) | 1,870 B | 870 B | 2.15 |
| compact probe | ~1,500 B | 757 B | 1.98 |

The weighted ratio for the final run's query mix is **1.63**. The earlier calibration against the 4.1 GB email assumed 1.0 for both; the measured production volume does not use that email figure.

### Projection

Assumptions: 8 seats, 20 minutes per 8-seat lobby (160 seat-minutes). The Neon-calibrated per-lobby transfer is 45.7 MB response + 29.3 MB request = 75.0 MB. Production main measured 94 MB for Nov 1–Dec 1, about 1.25 lobbies/month; the 115-lobby volume came from the 4.1 GB email and is withdrawn. Warm and cold are the same for new lobbies: the slice and delta paths do not use the in-memory league cache.

| Per 8-seat, 20-minute lobby | Round 5 baseline | Final (local) | Final (Neon ×1.63) |
|---|---|---|---|
| Response | 92.9 MB | 28.0 MB | 45.7 MB |
| Request | 29.8 MB | 18.0 MB | 29.3 MB |
| Total | 122.7 MB | 46.0 MB | 75.0 MB |
| Lobbies that fit 4 GB (total) | 33 | 89 | 54 |
| Lobbies that fit 5 GB (total) | 41 | 111 | 68 |
| Lobbies that fit 4 GB (response only) | 44 | 146 | 89 |
| Lobbies that fit 5 GB (response only) | 55 | 182 | 112 |

At the measured production volume (94 MB/month), the Neon-calibrated total is 94 MB, about 1.25 lobbies/month; 4 GB fits 54 lobbies/month and 5 GB fits 68. The old 115-lobby projection was driven by the 4.1 GB email and is withdrawn.

## Round 6: consistent projection and the playoff series

The round 5 projection mixed two ratios: the 115-lobby volume came from main's local wire bytes with an implied Neon ratio of 1.0, while the branch's ratio was 1.63. Round 6 measures both on the Neon dev branch; the volume is now the measured production traffic, not the 4.1 GB email.

### Production volume

The project used 5.57 GB for Nov 1–Dec 1: dev 5.48 GB and production main 94 MB. The dev branch is our tests. Main's 94 MB is about 1.25 8-seat 20-minute lobbies at 75.0 MB each, not the 120.5 lobbies derived from the 4.1 GB email; that email's usage was mostly testing. The branch's Neon/local ratio is 1.63, which is the per-lobby calibration; the old 4.1 GB volume calibration is withdrawn.

### Branch playoff ratio

The branch's stage-6 `SERIES_READ` moved 5,057 B of Neon body for a 5,917 B local series (ratio 0.85; the series sizes differ, and the overhead-adjusted ratio is about 1.0). The filtered series in the final run is 3,641 B per call. The playoff ratio is 1.0, not the assumed 1.1.

### Peer propagation at 1.5 s

The freshness journey with a 1.5 s watcher gap (three runs, 35 samples each) gives a ready p95 of 1,515 ms [1,513-1,522] and a p50 of 1,510 ms. The 2 s limit holds.

### Kept changes

1. **Revealed series only.** The stage-6..9 `SERIES_READ` keeps only the games the cursor has revealed, per series, in series order. The view is identical because `playoffViewsFrom` slices the same games. The replay fell from 24,757 KB [24,051-25,246] to 21,962 KB [21,922-22,484], an 11.3% cut beyond the run-to-run range.
2. **Compact regular standings.** The stage-0..3 delta no longer reads the meta row. It sends `[teamIndex, wins, losses, seed]` rows from the checkpoint and the client maps them with `LEAGUE_TEAMS` and `EAST_SET`, keeping the previous `humanName` and computing `my` from the me team. The replay fell from 21,962 KB to 19,425 KB [19,339-20,405], another 11.5%. `tests/league-slice.test.ts` merges the compact rows into the previous view for every regular stage, four cursor pairs and all eight seats and compares it to the full view.

### Rejected

- **Compact probe cut.** The probe is 3,298.7 KB of the final run (31.8%), but the target is met without it; the fixed Neon overhead per query (~120 B) limits the gain.
- **2 s reveal cadence.** Not needed; 1.5 s keeps the ready p95 at 1.5 s.

### Final 8-seat real-time run (971ca19)

The season window was 640.8 s (85.44 seat-minutes); the response was 10,383.7 KB and the request 7,609.9 KB, **121.5 KB/seat-minute response and 89.1 request**, down 30.7% from 175.3 and 79.1% from the round 5 baseline 581.0. The season, recap and Play Again completed; one 409 on seat 1 was a duplicate action.

| Query | Calls | Response KB | Per call |
|---|---|---|---|
| probe | 4,464 | 3,298.7 | 757 |
| series | 675 | 2,400.4 | 3,641 |
| read | 330 | 2,214.2 | 6,871 |
| meta (full read) | 183 | 1,332.7 | 7,457 |
| games | 2,801 | 1,255.9 | 459 |
| checkpoint | 2,687 | 1,132.7 | 432 |
| clock | 3,434 | 566.7 | 169 |
| clock-write | 724 | 73.7 | 104 |

### Projection

The branch's phase-weighted Neon ratio is 1.32 (probe 1.98, series 1.0, read 0.95, full meta 1.1, games 1.08, checkpoint 1.21, clock 1.63). At 120.5 lobbies (19,276 seat-minutes) the branch's response is 3.09 GB and the request 1.72 GB, 4.81 GB total. The round 5 branch at the same volume was 5.61 GB response. 152 lobbies fit 4 GB and 190 fit 5 GB.

| Per 8-seat, 20-minute lobby | Round 5 | Round 6 |
|---|---|---|
| Response, local | 28.0 MB | 19.4 MB |
| Response, Neon | 46.5 MB | 25.7 MB |
| At 120.5 lobbies, response | 5.61 GB | 3.09 GB |
| At 120.5 lobbies, total | 9.37 GB | 4.81 GB |
| Lobbies that fit 4 GB (response) | 84 | 152 |
| Lobbies that fit 5 GB (response) | 105 | 190 |

The Neon-calibrated response at the calibrated volume is 3.09 GB, under the 4 GB target and the 5 GB quota.

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
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --out evidence/perf --runs 3 --journeys season --modes normal --tag season
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --out evidence/perf --runs 3 --journeys freshness --fresh-gap 1500 --modes normal --tag fresh15
npx vitest run tests/league-slice.test.ts tests/league-reveal.test.ts
```

The `season` journey drives all eleven stages through the API, advancing the stage clock in controlled increments so the cursor moves three games per tick in the regular season and one per tick in the playoffs, with one full and occasional no-change poll per seat per tick. It finishes in about 12 s. The 8-seat UI run needs the local meter env on a `launch` and then `control.mjs league --players 8 --mode normal` (12.7 minutes of wall clock).

The Neon calibration runs the same metered runner against the dev branch. Main's calibration checks 28c0d2f out in a detached worktree outside the repo, symlinks the repo's `node_modules`, and removes the worktree after the measurement; the dev branch already has the additive schema, so no DDL is needed for main.

Evidence: `meter-<tag>-<timestamp>.json`, `ui-db-meter*.jsonl`, `db-meter.jsonl`, `server.log`. The cluster is stopped at the end.
