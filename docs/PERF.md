# Database transfer and latency

Neon bills public network transfer. Production spent 4.1 GB of the 5 GB monthly allowance running `main`'s old lobby. This measures the shared league on a local Postgres replay, expresses cost per seat-minute so it follows real wall-clock play, and covers the change that makes polls which change nothing cheap.

## How it is measured

`control.mjs perf` starts a throwaway Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs`, so every query is measured at the socket and repeated load never reaches Neon. Journeys are driver-level (the same `since`/`events`/`token`/`waiting` query the app sends) except the real-time run, which is the real client in a browser.

- `idle-lobby`: eight seats in a lobby, polling every second.
- `wait-building`: eight seats in the build phase with one build submitted, polling while they wait for the rest.
- `wait-checkpoint`: eight seats at a season checkpoint with nobody ready, polling while they wait for the group.
- `wait-reveal`: eight seats polling through a live reveal (no fast-forward), where every poll changes.
- `freshness`: eight seats polling every second; one seat readies, the rest of the group must see it, and the season start and a reveal must reach every seat.
- `league-<mode>`: the compressed eight-player journey from the previous round, kept for continuity.

The UI run is `control.mjs league --players 2 --base <local replay server>`: real timers, real browser, the app's own polling (1 s visible, 5 s hidden), against the local replay. The server's query log gives that run's real per-seat-minute cost.

`dbRequestBytes`/`dbResponseBytes` are Postgres wire bytes (framing included, TCP/IP headers excluded). Per-seat-minute is response bytes divided by seats times minutes in the window; the steady value excludes setup, so it is the polling cost alone. Parameters are inlined, so request bytes are the text actually sent.

## Real-time durations

The UI run (2 seats, 11.4 minutes, 22.8 seat-minutes) measured the phases with real timers:

| Phase | Seconds |
|---|---|
| First quarter | 120 |
| Second quarter | 125 |
| Third quarter | 123 |
| Fourth quarter | 1 |
| Awards | 0 |
| Play-In | 68 |
| Playoffs (first round, semis, finals, NBA finals) | 35 / 17 / 11 / 1 |
| Recap | end of run |

The game is reveal-dominated: 8 minutes of regular-season reveal, about 2 minutes of play-in and playoffs, and only a few seconds of waiting at checkpoints because the UI driver readies immediately. That run made 1,303 full reads and 77 waiting probes (5.6% of polls). Human lobbies wait longer, so 5.6% is a lower bound.

## Per-seat-minute (response bytes, median [range], three runs)

Baseline is `b268a2a`; after is the cheap waiting probe plus the client's waiting hint.

| Journey | Baseline | After | Change |
|---|---|---|---|
| Unchanged, idle lobby | 114.8 KB [114.8-137.5] | 45.5 KB [43.4-45.6] | -60% |
| Unchanged, waiting for builds | 370.0 KB [321.6-397.3] | 94.3 KB [93.6-103.3] | -75% |
| Unchanged, waiting at a checkpoint | 576.2 KB [564.6-619.5] | 55.9 KB [46.5-57.4] | -90% |
| Changing, mid-reveal | 584.5 KB [520.1-707.0] | 752.4 KB [549.4-812.8] | no gain (ranges overlap; the probe is skipped) |

Per query, the waiting probe costs about 0.7 KB of response and 1.4 KB of request; the full read it replaces costs about 3.5 KB and 2.1 KB. The probe returns the lobby's version, phase, stage clock, the caller's identity and a compact participant array, and the server decides 204 from the same version/token/maintenance rules the full read uses.

## Freshness

A peer's ready, the season start and a reveal reached every visible seat at p95 **1829 ms** [1606-1964] after the change, inside the 2 s limit. The baseline measured 2964 ms [1176-3009] with the same driver; the ranges are wide because the driver polls every second.

## The kept change

`b229f9f` **Answer unchanged waiting polls from a cheap probe.** When the client is waiting (a lobby, draw, building, preview, rematch or recap, or a season checkpoint) it now sends `waiting=1`. The route runs one probe query, compares the version and progress token, and returns 204 before the full read when nothing changed. The probe also refreshes the caller's heartbeat, so a seat that only receives 204s stays active.

The hint matters: without it the probe ran on reveal polls too and added about 2 KB per poll, which cancelled most of the gain (reveal per-seat-minute rose 20% in that run). With the hint, reveal polls take the same path as before.

Authorization, reconnect, host transfer, rematch readiness and auto-advance are covered by tests in `tests/league-api.test.ts`: an unchanged poll returns 204 and refreshes `last_seen`; a stale token or a version bump takes the full read; a removed player gets 403 on the cheap path; the checkpoint advance and the reveal clock still run on a poll; and the probe decision is asserted directly.

## Compressed journey (previous round, kept for continuity)

| Journey | Baseline DB bytes | After DB bytes | Per poll before → after |
|---|---|---|---|
| league-normal | 72.34 MB [51.71-95.53] | 4.87 MB [4.07-4.95] | 302.4 → 19.3 KB |
| league-salary | 57.90 MB [53.79-63.36] | 4.57 MB [3.98-4.65] | 309.1 → 19.4 KB |
| league-squad | 76.94 MB [72.91-87.16] | 8.02 MB [7.84-10.57] | 321.9 → 38.2 KB |

The compressed journey is reveal-dominated and has few waiting polls, so this round's change does not move it: at `b229f9f` it measures 4.71 MB [4.08-4.79], 4.24 MB [4.08-5.11] and 9.64 MB [8.79-10.27]. It is kept only as the earlier comparison.

## Projection from seat-minutes

Assumptions, stated because production counts were not available:

- 8 seats per lobby, 20 minutes of real play, 80% of the time visible (poll every 1 s) and 20% hidden (every 5 s): 50.4 polls per seat-minute.
- 25% of polls are waiting polls and 75% are reveal polls. The UI driver's 5.6% is a lower bound; 25% assumes humans take about a minute to build and ready at each checkpoint.
- Waiting costs 400 KB per seat-minute before (blend of idle 115, building 370, checkpoint 576) and 70 KB after (blend of 45, 94, 56).
- Reveal costs 585 KB per seat-minute before and after.

Per 8-seat, 20-minute lobby (160 seat-minutes): 86.2 MB before, 73.0 MB after, a 15% cut.

Calibration to the 4.1 GB actually spent: 4.1 GB at `main`'s 4.4 KB per poll is 932,000 polls. At 403 polls per lobby-minute that is 2,313 lobby-minutes, or 38.5 lobby-hours a month, or about 115 twenty-minute lobbies.

| At 115 lobbies/month | Before | After |
|---|---|---|
| 25% waiting polls | 9.9 GB | 8.4 GB |
| 50% waiting polls | 8.4 GB | 5.8 GB |
| 5.6% waiting polls (UI driver) | 9.3 GB | 9.1 GB |

Neither side fits the 5 GB allowance at that volume. The reason is the reveal poll: 75% of polls at 585 KB per seat-minute is 6.9 GB a month on its own. The shared league's participants and builds also make each poll about 9.4 KB (measured), twice `main`'s 4.4 KB. The next target is therefore the reveal poll, not the waiting poll: the caller's `build` and `salary_powers` are only needed while building and previewing, so dropping them from reads in season phases would remove roughly 2 KB from a 9.4 KB poll. That change was not made this round.

## Reproducing

```
node .claude/skills/verify-build-a-bucket/scripts/control.mjs perf --runs 3 --seconds 20 --journeys idle,wait,freshness,league --tag after
node .claude/skills/verify-build-a-bucket/scripts/control.mjs league --players 2 --base http://127.0.0.1:<port>
```

Evidence: `meter-<tag>-<timestamp>.json` (aggregate and every run), `db-meter.jsonl` (raw per-query log), `server.log`. The cluster is stopped at the end. The baseline worktree is `git worktree add --detach /tmp/bab-base-b268a2a b268a2a` plus the meter scripts, with `node_modules` symlinked.
