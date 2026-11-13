# Multiplayer lobbies

Optional realtime lobbies for 2 to 8 human players, backed by Neon Postgres and Vercel functions.
Single-player is unaffected: lobbies are an extra entry on the home screen.

## Rules

- The host picks the shared era (current or all-time) and which builds are allowed (guards, bigs, or both).
- Every player builds at the same time with the same builder as single-player: 10 traits, one team respin, one player respin.
- Season moments are off in lobbies. The season runs straight through so the barrier stays fair.
- The server validates each build against the runtime catalog, then runs the 82 game season with a server seed.
- Qualified or eliminated follows the single-player rule: seed 6 or better, or a play-in win.
- Playoff rounds reveal on one shared clock, so all qualifiers advance together.
- Eliminated players watch. They never enter the playoffs and never hold the barrier.
- Final standings rank by playoff finish, then by wins, then by OVR.

## Flow

| Phase | Who moves it | What the players see |
|---|---|---|
| `lobby` | host starts | invite code, seats, shared settings |
| `building` | players submit builds | own builder, every peer's filled count and latest pick |
| `season` | the server | results arriving, one line per player |
| `barrier` | any client, after a 3 second hold | "n/8 ready". Playoffs start together |
| `playoffs` | the reveal clock, `revealSeconds` per round | own bracket, round counter, countdown |
| `finished` | the reveal clock | standings table and the champion |

One line under the roster is the live activity ticker. It shows the newest event, for example
"Dev took Kyrie Irving's FIN A+", "Eli finished 51-31, #3 seed" or "Gus is waiting at the playoff barrier".
Peer chips show each player's filled count while they build, so a pick reaches the other screens in under
2.5 seconds on the dev stack.

Nothing reveals a playoff result before its round is revealed. A finish label such as "Semis" and the
champion flag appear only once that player's own run is fully revealed.

The readiness line is defined once: players who have a result (qualified, eliminated, in the playoffs or done)
over the players who are present. Away players and players who left are excluded, so the same lobby shows the
same number at the barrier and in the standings.

A player who is unseen for 60 seconds counts as away. Away players do not hold the barrier.
The host can release the barrier early with "start playoffs now".
If the host is away for 45 seconds, or leaves, the earliest joined present player becomes host.

Leaving before the start deletes the seat, so a full lobby can take a new player. Leaving after the start keeps
the record and marks the seat as left.

## API

All endpoints are Web-standard handlers under `api/`, and all send the participant secret as
`authorization: Bearer <32 hex chars>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/lobby` | create a lobby, creator becomes host at seat 1 |
| GET | `/api/lobby/:code?since=<version>` | poll the view; 204 when the version is unchanged |
| POST | `/api/lobby/:code/join` | take the lowest free seat; same secret resumes the same seat |
| POST | `/api/lobby/:code/start` | host only, phase `lobby` to `building` |
| POST | `/api/lobby/:code/build` | best effort draft sync for the live roster |
| POST | `/api/lobby/:code/submit` | validate the build, run the season, store the result |
| POST | `/api/lobby/:code/release` | release the barrier; `force` is host only |
| POST | `/api/lobby/:code/leave` | mark the seat as left and hand over the host role |

Every POST carries a client action id. The server stores `(participant_id, action_id)` in `actions`,
so a retry returns the same outcome and never applies a change twice.

Errors use `{ error, reason }` with reasons `not_found` (404), `full` (409), `started` (409),
`forbidden` (403), `conflict` (409), `invalid` (400) and `server` (503).

## Database

`db/schema.sql` holds four tables: `lobbies`, `participants`, `events`, `actions`.
Run `npm run db:migrate` to apply it. The script is idempotent.

- Every mutation bumps `lobbies.version` in the same statement, so clients sync on one number.
- Joins use one statement that assigns the lowest free seat. A lost race retries with a bounded delay,
  so 12 concurrent joins produce exactly 8 seats.
- Phase changes are conditional updates. The release statement re-reads the target row, so two
  simultaneous release attempts compute the playoffs once.
- `npm run prune:lobbies -- <hours>` deletes lobbies idle for longer than the given window (default 24).

## Transport and privacy

The client polls every second while visible and every five seconds while hidden. It re-fetches
immediately after its own actions. Errors show a "reconnecting" badge and back off to eight seconds.
Requests time out after eight seconds.

The lobby view exposes names, seats, statuses, build summaries, results and the last 30 events.
It never exposes another player's secret, hash, participant id, or IP. A lobby is only reachable by code.
Names are trimmed to 16 characters, and control characters are removed.

## Local development and tests

`npm run dev` serves the app and mounts `api/` on one port. `DATABASE_URL` is read from `.env.local`
and never logged or committed.

- `tests/mp-codes.test.ts` covers code and secret handling.
- `tests/mp-lobby.test.ts` drives the handlers against the real Neon dev branch: capacity, reconnect,
  idempotency, host rules, host handover, build validation, the barrier, the reveal clock, privacy
  and cleanup of every lobby it creates.
- `e2e/lobby.spec.ts` drives eight browser contexts at the iPhone 14 profile through create, join,
  start, build, sim, barrier, synchronized reveal and final standings, and reloads one player mid-build.

## Known limits

- Identity is one secret per device. A second device is a new participant.
- It is a namespace, not a room: `docker build` style chat, voice and spectating are not built.
- The transport is HTTP polling. Long-poll or SSE is a hill-climb candidate if measurements ask for it.

## Where this differs from CONTRACT.md

- Idempotency uses a dedicated `actions` table instead of expression indexes on `events`. The events
  table stays a plain activity feed.
- The barrier holds for 3 seconds after the last result (`BARRIER_HOLD_SECONDS`) so every client sees
  the wait and the reveal starts on one clock.
- The `season` phase means "results are coming in"; `barrier` is entered by a conditional maintenance
  update when no present player is still building.
- A late draft sync can never overwrite a stored result; the guard sits in the update that writes the build.
