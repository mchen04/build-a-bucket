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

- Dev stack (app + API + Neon dev branch from the gitignored `.env.local`): `control.mjs launch [--port 4391]`.
- Production build of the static app (no API, for cold-load timing): `control.mjs launch --prod [--port 4392]`.
- Ready means `GET /` serves `<title>Build a Bucket</title>` and, in dev mode, `GET /api/lobby/ZZZZZZ` returns 404 `not_found`. That second probe reaches Neon, so the database is live too. The command waits up to 90 s and exits non-zero if not ready.
- Never use port 4173: Playwright's `webServer` reuses whatever listens there, so a verification server would capture `npm run e2e`.
- The first catalog load fetches pinned data from jsDelivr; a cold start without network fails the builder, not the launch.
- Deployed stack: skip launch and pass `--base https://<deployment>` to `lobby-load` or `--url` to `cold-load`.

## Doctor

`control.mjs doctor` is read-only: the run's process alive, the port owned by that process tree, HEAD unchanged since launch, app identity, API reaching Neon. `ok: false` means relaunch, not drive. Run it first whenever anything looks off.

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
| `reload`, `goto:<path>`, `wait:<ms>` | navigation |
| `shot:<name>` | `<name>.png` and `<name>.aria.txt` |
| `storage:<name>` | dump localStorage to `<name>.json` (the persistence side effect) |

- Targets are `role:Name` (Playwright accessible name, `/regex/` allowed), `text:...`, `label:...` or `css:...`. Prefer roles and the `data-testid` handles listed in `features/`.
- Page errors and console errors are reported in the result; treat any as a failure to explain.

## Drive a full shared league

`control.mjs league --players 2..8 [--mode normal|salary|squad] [--era current|alltime] [--device iphone|pixel] [--viewport WxH] [--reload SEAT] [--away SEAT] [--host-leave] [--base URL]`

One command opens N real browser contexts and walks the whole multiplayer path through the phone UI: create the lobby, read the invite link, the other seats open that link and join by name, everyone draws and the host rerolls once, builds in the chosen mode (ten real spins in Normal, one pick per column plus a Salary power, five Squad builds), previews, runs every checkpoint with Ready and a host Advance, reads awards, play-in, playoffs and the recap, then does Play Again (each retained seat readies, the host opens the draw) and starts the second game.

- At every checkpoint it reads each participant's `standings`, `my-team` record and seed, and the champion banner, and fails if the visible standings disagree, if a seat's record or seed disagrees with its own standings row, or if awards, play-in, playoffs or the champion appear before their stage. It also fails when a seed appears during the season.
- Evidence is `evidence/league/<seat>-<name>-<checkpoint>.png` plus `.aria.txt` for every active seat at every checkpoint; the JSON summary is `evidence/league/summary.json` and names the code, mode, era, chaos, each checkpoint's visible standings and each seat's record/seed, the champion, Play Again, and page/console errors.
- Chaos, applied at the first checkpoint: `--reload SEAT` reloads that seat mid-season and re-checks its standings; `--away SEAT` closes that session and proves the host can still advance; `--host-leave` leaves from the host seat and proves host transfer (another seat gets Advance). `--away` and `--host-leave` are separate scenarios.
- The season reveal is real time: a measured two-player league took about 12 minutes because each quarter reveals about 300 league games. Run it in the background or with a long timeout. The command has no internal setters or database jumps; `ui-fixture` remains for screenshots only.
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
- **Schema.** Run `npm run db:migrate` against the deployed database (the same script reads `.env.local` or `BAB_ENV_FILE`, applies `db/schema.sql`, and prints the five table names). It must print `db/schema.sql applied` and `tables present: actions, events, lobby_teams, lobbies, participants`; a missing table means the API will fail on that endpoint.
- **Live smoke.** `control.mjs cold-load --url https://<deployment> --runs 3` proves the deployed bundle, the pinned catalog and the first spin; `control.mjs lobby-load --base https://<deployment> --players 8 --seconds 20` proves the deployed API and Neon under a full lobby. Deployed lobbies are not deleted by `cleanup`; run `npm run prune:lobbies` on that database.
- **Driven league.** `control.mjs league --players 2 --mode normal --base https://<deployment>` is the user-path smoke for the deployed stack. It needs the deployed API, so do not point it at `launch --prod`.

## Evaluate performance

- `control.mjs cold-load --runs 5 [--visits 2]` (against `launch --prod`, a preview deployment or `--url https://build-a-player.com/bucket`) uses the same conditions as the original's baseline: iPhone 14 profile, 9/1.5 Mbps, 60 ms RTT, CPU 4x, cache off, fresh context per run. It reports the median and range of FCP, LCP, TTI-ish (first enabled `PLAY` button), `firstSpinMs` (tap Play as soon as it is enabled, tap SPIN, stop at the first enabled `.chip:enabled`), load, bytes, requests, heap, long tasks and per-request timing in order (DNS/TCP/TLS plus bytes). `--visits 2` navigates twice in the same context with app storage cleared between visits and adds `repeatSummary` for the second navigation. Compare only runs from the same host under similar load (`uptime`), interleaving baseline and candidate.
- `control.mjs lobby-load --players 8 --extra 4 --seconds 20 --poll 1000 [--base URL] [--drafts off]` creates a lobby, fires all joins at once (8 seats plus 4 over capacity), starts, then every seat polls each second the way the app does (`since`, `token`, `events`) and pushes draft syncs with a pick each time. It reports p50/p95/max per endpoint, status counts (full view, delta, 204), response bytes per endpoint, the seats handed out (must be 8 distinct) and the share of 204 polls. `--drafts off` isolates polling.
- `control.mjs perf --runs 3 --seconds 20 [--modes normal,salary,squad] [--journeys solo,idle,league] [--tag name]` is the database-transfer meter. It starts a throwaway local Postgres cluster and a dev server whose `QueryRunner` is `scripts/meter/local-pg.mjs` (Postgres wire protocol, installed only when `BAB_DB_RUNNER` is set), then runs the solo, idle-lobby and full eight-player league journeys (all three modes, with a mid-season reload and a rematch) and reports per journey: DB requests, DB request and response wire bytes, DB time p50/p95/max, API requests and response bytes, and the static payload. Repeated load never reaches Neon. `features/perf.md` has the details and the evidence layout.
- Database time: run the same `lobby-load` against the dev server, a preview deployment and production. The dev server adds no queueing, so the gap is network plus function cold start.
- Keep a change only when its medians beat the baseline outside the run-to-run range. Record rejected hypotheses with their numbers.

## Evidence

- Proof is the user path: taps through the UI, not internal setters or test endpoints. Capture the action and the resulting state (shot plus aria), and the side effect (`storage:` for local persistence; `lobby-load` JSON or a second player's view for server state).
- Each `ui` call appends its result to `<run>/evidence/journal.jsonl`; perf results go to `<run>/evidence/perf/`.
- Report a journey that could not run with the exact failing step and its unmet precondition. Never shorten a journey to make it pass.

## Cleanup

`control.mjs cleanup` stops only the process tree this run launched, deletes the lobbies this run created (dev database only, by recorded code), removes saved sessions, and keeps `<run>/evidence/`. It prints the evidence path and file count, which must be non-zero. Lobbies made on a deployed stack are left for `npm run prune:lobbies` on that database.

## Features

See [features/README.md](features/README.md).
