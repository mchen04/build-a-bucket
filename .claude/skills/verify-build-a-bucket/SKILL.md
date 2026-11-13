---
name: verify-build-a-bucket
description: Drive the Build a Bucket rebuild (Preact web app plus Vercel lobby API on Neon) the way a phone user does, capture evidence, and measure whole-stack performance (cold load, lobby API under a full 8-player lobby). Use to prove a gameplay, multiplayer or mode change works, before a PR or after a deploy.
---

# Verify Build a Bucket

The app is a mobile web game: one home screen with single-player Play, Daily Challenge, Salary Cap, Squad Builder, Career, and multiplayer lobbies (2 to 8 players, invite codes). The lobby API lives under `api/lobby/**` as Web-standard handlers backed by Neon Postgres. Everything is driven through one helper:

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

## Evaluate performance

- `control.mjs cold-load --runs 5` (against `launch --prod`, a preview deployment or `--url https://build-a-player.com/bucket`) uses the same conditions as the original's baseline: iPhone 14 profile, 9/1.5 Mbps, 60 ms RTT, CPU 4x, cache off, fresh context per run. It reports the median and range of FCP, LCP, TTI-ish (first enabled `PLAY` button), load, bytes, requests, heap and long tasks. Compare only runs from the same host under similar load (`uptime`), interleaving baseline and candidate.
- `control.mjs lobby-load --players 8 --extra 4 --seconds 20 --poll 1000 [--base URL]` creates a lobby, fires all joins at once (8 seats plus 4 over capacity), starts, then every seat polls `since=version` each second and pushes draft syncs. It reports p50/p95/max per endpoint, status counts, the seats handed out (must be 8 distinct), and the share of 204 polls. Use `--drafts off` to isolate polling.
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
