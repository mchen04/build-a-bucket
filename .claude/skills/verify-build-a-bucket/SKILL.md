---
name: verify-build-a-bucket
description: Drive the Build a Bucket rebuild (Preact web app plus Vercel lobby API on Neon) the way a phone user does, capture evidence, and measure whole-stack performance (cold load, lobby API under a full 8-player lobby). Use to prove a gameplay, multiplayer or mode change works, before a PR or after a deploy.
---

# Verify Build a Bucket

The app is a mobile web game: one home screen with single-player Play, Daily Challenge, Salary Cap, Squad Builder, and one shared multiplayer NBA league (2 to 8 players, invite codes). There is no Career mode in this rebuild. The lobby API lives under `api/lobby/**` as Web-standard handlers backed by Neon Postgres. Everything is driven through one helper:

```
node .claude/skills/verify-build-a-bucket/scripts/control.mjs <command> [options]
```

Run all commands from the repository root. Each run gets its own folder under `$BAB_VERIFY_HOME` (default `~/.cache/verify-build-a-bucket/<timestamp>/`); `current` in that folder points at the active run. Evidence lives in `<run>/evidence/` and survives cleanup.

## Launch

- Dev stack (app + API + throwaway local Postgres): `control.mjs launch [--port 4391]`. The cluster is created under the run directory and removed by `cleanup`; Postgres 16 is required (`BAB_PG_BIN`, default `/opt/homebrew/bin`). Pass `--neon` to use the Neon dev branch from the gitignored `.env.local`; never use that for tests or the production project.
- Production build of the static app (no API, for cold-load timing): `control.mjs launch --prod [--port 4392]`.
- Ready means `GET /` serves `<title>Build a Bucket</title>` and, in dev mode, `GET /api/lobby/ZZZZZZ` returns 404 `not_found`. That second probe reaches the run's database (local by default), so the database is live too. The command waits up to 90 s and exits non-zero if not ready.
- Never use port 4173: Playwright's `webServer` reuses whatever listens there, so a verification server would capture `npm run e2e`.
- The first catalog load fetches pinned data from jsDelivr; a cold start without network fails the builder, not the launch.
- Deployed stack: skip launch and pass `--base https://<deployment>` to `lobby-load` or `--url` to `cold-load`.

## Doctor

`control.mjs doctor` is read-only: the run's process alive, the port owned by that process tree, HEAD unchanged since launch, app identity, API reaching the run's database. `ok: false` means relaunch, not drive. Run it first whenever anything looks off.

## Drive

`control.mjs ui --feature <id> [--device iphone|pixel] [--session <name>] [--path /] --step <verb:arg> ...`

- `iphone` is WebKit iPhone 14, `pixel` is Chromium Pixel 7; the viewport is forced to 390x844.
- `--session <name>` keeps cookies and localStorage between invocations. Use one session per simulated player; a later invocation with the same name is that player reloading.
- Steps run in order and stop at the first failure (screenshot `failure.png`):

| Step | Meaning |
|---|---|
| `click:<target>` | tap |
| `fill:<target>=><value>` | type into a field |
| `see:<target>` / `gone:<target>` | wait up to `--timeout` ms (20000) |
| `read:<key>=<css>` | store the element text as `{key}`, usable in later steps and later invocations; lobby codes are recorded for cleanup |
| `spinpick:<n>` | spin and take the first open trait until n more slots fill (stops at 10) |
| `season[:ms]` | answer every Moment with its first option and skip to the season result |
| `until:<css>\|<css1>,<css2>` | click whichever listed control is visible until `<css>` shows (season and offseason loops) |
| `repeat:<n>\|click:<target>` | click only if visible, n times (optional screens) |
| `overflow` | fail if the page scrolls vertically or horizontally |
| `scroll:<target>` | scroll the target to the top of the viewport |
| `cover:<target>` | fail if any fully visible row inside the target is covered by something other than its own sticky header; logs `rows`, `visible`, `coveredByHeader`, `coveredByOther` |
| `reload`, `goto:<path>`, `wait:<ms>` | navigation |
| `shot:<name>` | `<name>.png` and `<name>.aria.txt` |
| `storage:<name>` | dump localStorage to `<name>.json` (the persistence side effect) |

- Targets are `role:Name` (Playwright accessible name, `/regex/` allowed), `text:...`, `label:...` or `css:...`. Prefer roles and the `data-testid` handles listed in `features/`.
- Page errors and console errors are reported in the result; treat any as a failure to explain.

## Drive a full shared league

`control.mjs league --players 2..8 [--mode normal|salary|squad] [--era current|alltime] [--device iphone|pixel] [--viewport WxH] [--reload SEAT] [--away SEAT] [--host-leave] [--base URL]`

One command opens N real browser contexts and walks the whole multiplayer path through the phone UI: create the lobby, read the invite link, the other seats open that link and join by name, everyone builds in the chosen mode (ten real spins in Normal, one pick per column plus a Salary power, five Squad builds), then everyone draws and the host rerolls once, previews, watches awards and play-in resolve on their own, clears the one playoff gate with Ready and a host Start playoffs, reads every playoff round and the recap, then does Play Again (each retained seat readies, the host opens the builds) and starts the second game.

- At every stage it reads each participant's `standings`, `my-team` record and seed, the next-action line and the shared activity log, and fails if the visible standings disagree, if a seat's record or seed disagrees with its own standings row, or if awards, play-in, playoffs or the champion appear before their stage. It also fails when a seed appears during the season or an unexpected checkpoint appears outside the playoff gate.
- Each league invocation creates a new `evidence/league-<ISO time>-<suffix>/` directory and fails if that path already exists. Its `<seat>-<name>-<stage>.png` plus `.aria.txt` cover every active seat at every stage, and `<seat>-<name>-standings-scrolled.png` records the first stage with the standings scrolled to the top and how many rows were visible and covered by another element. The invocation's JSON summary is `<that directory>/summary.json` and names the code, mode, era, chaos, `reload`, each stage's visible standings and each seat's record/seed, the champion, Play Again, page/console errors, and `httpErrors` (every response with status 400 or above, with method, URL, status and the first 300 bytes of the body). It also records `phaseDurations` (build complete to season start, season end, each playoff round and recap), `marks` (the raw timestamps), `actions` (per-seat counts after the builds, by control name: Ready, Start playoffs, Play Again, Rematch Ready, Rematch Start), `gateWaits` and `gateWaitTotals` (per seat and the playoff gate, from the gate appearing to the round starting and from its own ready tap to the start), and `apiLatency` (per endpoint observed by the browser: count, p50/p95/max, status counts). Older `evidence/league/` directories remain readable. Gate controls are clicked only when present, so a league with no qualifying human skips the gate and still finishes. The replay checker reconciles each summary's `players`, `mode`, `device`, `chaos`, `stages` (`after-reload`, `away`, `host-left`), per-seat `errors`/`httpErrors`, `reload` and `champion` against the plan, so those records must describe what actually happened.
- Chaos, applied at the first sampled stage: `--reload SEAT` reloads that seat mid-season and compares the first ten rows of each conference only between seats that report the same displayed revision, read as structured `{ stage, progress }` from the two dedicated stage-name and progress elements (`league-stage-name`, `league-stage-progress`) in one atomic in-page read; each field is that element's trimmed visible text, and a missing, hidden or blank element gives an empty field, never another element's text. Full row text is kept and the seat's own-team rows after the tenth are ignored. A revision is valid only when both the stage label and the progress line are present and non-empty; a missing, empty or partial revision never joins a comparison, and recap without a displayed stage is not a revision. Seat identity is the positive integer seat number: the same number under two names is a conflict and fails, and the refreshed seat's number must be among the compared seats. It fails if no valid common revision appears, if the compared set is empty, if any conference has zero rows, if any canonical row is blank, if fewer than two distinct seat numbers share the revision, if the refreshed seat is missing, or if rows differ. `--reload` also fails unless the refresh step recorded a non-empty comparison including the refreshed seat, recorded as `reload: { ran, revision: { stage, progress }, seats, rowsCompared, refreshedSeat, coverage }`; `coverage` is `ok` only for a valid revision with at least two distinct seat numbers including the refreshed seat, a positive integer `rowsCompared`, and no blank canonical row. If the refreshed seat lands on recap with no valid revision, the run fails with that reason and still writes its summary. `--away SEAT` closes that session and proves the host can still start the playoffs; `--host-leave` leaves from the host seat and proves host transfer (another seat gets Start playoffs). `--away` and `--host-leave` are separate scenarios.
- The season reveal is real time and shared by every seat from one server state. CPU-only games take about 2.4 ms each, so a CPU-only round is effectively instant. Regular-season games with a human take 60 ms each, and each playoff game in a series with a human is its own 700 ms step. A finished playoff round that included a human series is held for two steps so every seat sees the deciding game and the result before the next round. Clients poll every 350 ms during the playoffs. An 8-player league takes about 10 s of season and 15-35 s of playoffs. Run it in the background or with a long timeout. The command has no internal setters or database jumps; `ui-fixture` remains for screenshots only.
- In-page record: when the playoff gate appears, each seat installs an observer that timestamps every change of its `my-matchup` card (score and teams), the matching bracket row score read at the same moment, the next-action line, the activity log, and the poll request times (resource timing, buffer raised). After the recap it fails if a human series of 4+ games skips a game (unless a poll gap longer than the step covers that exact interval), does not start at 0-0, goes backwards, leaves an unfinished series for a new round, or disagrees with its bracket row, and fails if seat activity logs differ at the gate or the recap. `summary.json` carries `seriesTimeline`, `seriesScores` and `pollGaps` (p50/p95/max per seat).
- Gate rules to expect: only active qualifying humans are asked to Ready; the host can Start at any time; when only the host is unready the playoffs start on their own after 90 s (`CHECKPOINT_IDLE_MS`) with a log line naming the host; with no qualifying human there is no visible gate.
- Heavy runs (full suites and the league matrix) belong on the main Mac (mbp-main), one heavy job at a time, with at least 25% memory free (`memory_pressure`). The mini is reserved for another project. Pick a free port at run time, keep an isolated `BAB_VERIFY_HOME`, and never stop a process the run did not start: the main Mac carries unrelated listeners and dev servers.
- The command records the lobby code, so `cleanup` deletes it on the dev database.

## Parity with the original

`control.mjs` is the UI harness; `scripts/parity/run.mjs` is the rules harness. It fetches the original game at the pinned commit, runs its own code in a stubbed browser with network disabled, and compares OVR, spin order, Daily plans, Salary grids and budgets, salary powers, the season result and the Squad season field by field against our engine.

- Full sweep: `node .claude/skills/verify-build-a-bucket/scripts/parity/run.mjs --seeds 20`. The harness registers its own module hooks before importing our TypeScript engine, so plain `node` works. It prints one line per area and exits non-zero on any mismatch or oracle failure.
- One area: `--area season,salary`; cached source: `--cache <dir>` (default `~/.cache/bab-parity`).
- Recorded fixtures: `--write-fixtures` rewrites `tests/fixtures/oracle/`. `tests/parity-oracle.test.ts` replays those fixtures offline and is the check that runs in CI.
- `features/parity.md` has the full recipe. Use it before claiming a rule matches the original.

## Production checks

Run these after a deploy, in addition to the local journey:

- **Asset hash.** `curl -s https://<deployment>/ | grep -o 'assets/[^"]*\.js'` must name the same content-hashed bundle that the local production build emitted under `dist/assets/`. A different hash means the deployment is serving an older build; compare the file name, not just the page title.
- **Schema.** Run `npm run db:migrate` against the deployed database (the same script reads `.env.local` or `BAB_ENV_FILE`, applies `db/schema.sql`, and prints the eight table names). It must print `db/schema.sql applied` and `tables present: actions, events, league_slice_checkpoints, league_slice_games, league_slices, lobby_teams, lobbies, participants`; it exits non-zero and names any missing table, which means the API will fail on that endpoint.
- **Live smoke.** `control.mjs cold-load --url https://<deployment> --runs 3` proves the deployed bundle, the pinned catalog and the first spin; `control.mjs lobby-load --base https://<deployment> --players 8 --seconds 20` proves the deployed API and Neon under a full lobby. Deployed lobbies are not deleted by `cleanup`; run `npm run prune:lobbies` on that database.
- **Driven league.** `control.mjs league --players 2 --mode normal --base https://<deployment>` is the user-path smoke for the deployed stack. It needs the deployed API, so do not point it at `launch --prod`.
- **Server-side league meter.** `node .claude/skills/verify-build-a-bucket/scripts/meter/league-meter.mjs --out <dir> [--port 4395] [--pg-port 55433] [--players 2]` starts a throwaway local Postgres and the dev server, measures the pure `simulateLeague` time over five runs, then drives create/join/start/lock/preview/season and the playoff gate over HTTP. It reports `engineSimulation`, `simulationRequest` (the ready call that simulates the season), every request's wall time with its DB request count and DB time, and p50/p95/max per endpoint. The raw Postgres wire log and server log are written beside `league-meter.json`; the cluster is stopped and removed unless `--keep`.

## Evaluate performance

- `control.mjs cold-load --runs 5 [--visits 2]` (against `launch --prod`, a preview deployment or `--url https://build-a-player.com/bucket`) uses the same conditions as the original's baseline: iPhone 14 profile, 9/1.5 Mbps, 60 ms RTT, CPU 4x, cache off, fresh context per run. It reports the median and range of FCP, LCP, TTI-ish (first enabled `PLAY` button), `firstSpinMs` (tap Play as soon as it is enabled, tap SPIN, stop at the first enabled `.chip:enabled`), load, bytes, requests, heap, long tasks and per-request timing in order (DNS/TCP/TLS plus bytes). `--visits 2` navigates twice in the same context with app storage cleared between visits and adds `repeatSummary` for the second navigation. Compare only runs from the same host under similar load (`uptime`), interleaving baseline and candidate.
- `control.mjs lobby-load --players 8 --extra 4 --seconds 20 --poll 1000 [--base URL] [--drafts off]` creates a lobby, fires all joins at once (8 seats plus 4 over capacity), starts with `{ era: 'current', mode: 'normal' }` (the lobby opens in the build phase), then every seat polls each second the way the app does (`since`, `token`, `events`) and submits one full build replayed from its own build seed (the driver loads `spinTarget` from `src/shared/engine/spin.ts` through Vite, so the server accepts the spin history). It reports p50/p95/max per endpoint, status counts (full view, delta, 204), response bytes per endpoint, the seats handed out (must be 8 distinct) and the share of 204 polls. `--drafts off` isolates polling. Expected output: `startStatus: 200`, `seated` and `distinctSeats` equal to `--players`, `buildSyncStatus: { "200": <players> }`, and no `lobby-load: build syncs rejected` line on stderr (that line means a non-2xx build and sets exit code 1).
- `control.mjs perf --runs 3 --seconds 20 [--modes normal,salary,squad] [--journeys solo,idle,wait,freshness,league] [--tag name]` is the database-transfer meter. It starts a throwaway local Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs` (Postgres wire protocol, installed only when `BAB_DB_RUNNER` is set), then runs the solo, idle-lobby, waiting (build phase, playoff gate, live reveal), freshness and full eight-player league journeys and reports per journey: DB requests, DB request and response wire bytes, DB time p50/p95/max, bytes per poll, bytes per seat-minute (steady polling window), API requests and response bytes, and the static payload. `freshness` reports the p95 time for a ready, a season start and a reveal to reach every seat; the limit is 2 s. Repeated load never reaches Neon. `features/perf.md` has the details and the evidence layout.
- Database time: run the same `lobby-load` against the dev server, a preview deployment and production. The dev server adds no queueing, so the gap is network plus function cold start.
- Keep a change only when its medians beat the baseline outside the run-to-run range. Record rejected hypotheses with their numbers.

## Evidence

- Proof is the user path: taps through the UI, not internal setters or test endpoints. Capture the action and the resulting state (shot plus aria), and the side effect (`storage:` for local persistence; `lobby-load` JSON or a second player's view for server state).
- Each `ui` call appends its result to `<run>/evidence/journal.jsonl`; perf results go to `<run>/evidence/perf/`.
- Report a journey that could not run with the exact failing step and its unmet precondition. Never shorten a journey to make it pass.

## Cleanup

`control.mjs cleanup` stops only the process tree this run launched, deletes the lobbies this run created for a `--neon` run (by recorded code), discards the local cluster, removes saved sessions, and keeps `<run>/evidence/`. It prints the evidence path and file count, which must be non-zero. Lobbies made on a deployed stack are left for `npm run prune:lobbies` on that database.

DB-backed vitest and Playwright use `npm run test:local-db` and `npm run e2e:local-db`, which start a throwaway local Postgres, apply `db/schema.sql`, run and stop it. `control.mjs launch` defaults to the same local setup. The Neon dev branch is opt-in only (`control.mjs launch --neon`); never run the checks against the production project.

## Features

See [features/README.md](features/README.md).
