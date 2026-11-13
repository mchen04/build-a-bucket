# Shared multiplayer league

One server-authoritative NBA league for 2 to 8 friends, backed by Neon Postgres and Vercel functions. Every
friend replaces a different NBA team; the other teams are computer controlled. The same schedule, results,
standings, seeds, awards and champion are shown to every participant.

Single-player modes are unchanged. A lobby never reads or consumes the solo Daily allowance.

## Flow

| Phase | Who moves it | What the lobby sees |
|---|---|---|
| `lobby` | host starts | invite code, seats, mode and era |
| `draw` | each participant, host can lock | one unique team each, one reroll, unclaimed pool |
| `building` | each participant | Normal, Salary Cap or Squad builder for the assigned team |
| `preview` | everyone readies, host can start | every team with its build OVR |
| `season` | the server reveals | four quarter checkpoints, scores, partial standings |
| `awards` | everyone readies, host can advance | final standings and awards |
| `playin` | everyone readies, host can advance | play-in results |
| `playoffs` | the server reveals game by game | first round, semis, conference finals, finals |
| `recap` | host rematches | champion, every finish, friend head-to-head |

The host chooses one mode (`normal`, `salary`, `squad`) and one era (`current`, `alltime`). The mode and era are
fixed for the league; a rematch keeps them and the same seats and code.

## Team assignment

`lobby_teams` has one row per human participant with `primary key (lobby_id, participant_id)` and
`unique (lobby_id, team)`. The database, not the application, is the authority on uniqueness.

- A draw picks a random team from the pool that has no row for this lobby. Two concurrent draws can pick the
  same team; one insert wins and the other retries with a new random pick.
- A reroll is allowed once. The update is guarded by `not reroll_used` and excludes the current team. A retried
  request with the same action id returns the stored row and never spends a second reroll.
- Assignments lock when the host starts building (`locked_at`) or when the last present participant draws.
  The host can lock early; participants who have not drawn receive a draw from the server first.
- A reconnect with the same secret resumes the same seat, team, reroll state and build.

## Schedule

`buildSchedule(seed)` in `src/shared/engine/league.ts` builds a deterministic 30-team schedule.

- Base: a circle-method double round-robin, so every pair plays home and away once (58 games per team).
- Extra: each conference plays six extra distance rounds (the 15-team cyclic distances 1-7, six chosen by the
  seeded shuffle), two home/away games per pair in each chosen distance. Every team gets 24 extra games and
  exactly 82 regular-season games.
- Games are packed into rounds where neither team plays twice, then flattened into `gameNo` order. Round 21,
  41 and 62 are the quarter checkpoints.
- Results are computed once from the lobby's server seed (`lobbies.season_secret`) when every present
  participant has a build and the league starts. Each game's RNG is keyed by the seed and `gameNo`, so the
  result is independent of request order.

`league_games` stores one row per game with `primary key (lobby_id, game_no)`: regular games first, then
play-in games, then playoff games. A game involving two human teams is one row, so both participants read the
same score.

## Team strength and the adapted formulas

The solo engines remain the source for ratings, stats, awards and series probabilities. The shared league needs
one extra step the solo simulations never needed: a game between two separately rated teams.

- Normal and Salary builds use `ovrFromValues` for the player OVR. The human team's win probability is
  `winProbFor(ovr, team, era)` from `src/shared/engine/season.ts` (the solo formula).
- Squad's five builds use `squadStrength(team, starters, builds, era)` from `src/shared/engine/squad.ts`;
  the human team's win probability is the squad season's `0.2 + ((off+def)/200 - 0.59)/0.24 * 0.57` clamped to
  0.13..0.87.
- A CPU team uses `teamStrength(team, table)` — the same 0.13..0.77 curve the solo engine uses for opponents.
- Two teams meet with the squad engine's matchup adaptation:
  `raw = (a - a*b) / (a + b - 2*a*b)`, `p = 0.5 + (raw - 0.5) * 1.12`, clamped 0.15..0.85. The home side gets
  +0.02 for home court. Scores reuse the solo 94-116 base and 3-19 margin.
- Regular-season standings use wins, then head-to-head, then conference record, then a seeded coin derived from
  the league seed and the team. Seeds 1-6 go straight to the playoffs; 7-10 play the play-in.
- The play-in is the solo bracket shape (7v8, 9v10, loser of 7v8 hosts the 9/10 winner). The playoffs are a
  16-team bracket (1v8, 4v5, 3v6, 2v7 in each conference), best-of-seven with the 2-2-1-1-1 home pattern.
  A series game's RNG is keyed by the seed, series id and game index.
- Awards reuse the solo award score (`ppg + 1.5*apg + 0.75*rpg`, the MVP benchmarks, the DPOY score and
  threshold). A human wins only by beating the benchmark; otherwise a computer star from the display pools wins.
  The human stats come from `rollStats(values, position, seededRng(seed:participant))`.
- The recap's head-to-head counts every game the two friends played, including play-in and playoff games.

These are intentional adaptations, not solo parity claims: solo seasons simulate one team against simulated
opponents, while this league simulates one 1,230-game schedule with one authoritative result per matchup.

## Reveal and pacing

`lobbies.stage` is the checkpoint index and `lobbies.stage_cursor` is how much of the current stage has been
revealed. `stage_started_at` drives the automatic reveal.

| Stage | Contents | Reveal |
|---|---|---|
| 0-3 | regular-season quarters | a batch of 3 games every 1.2 s |
| 4 | awards and final standings | on entry |
| 5 | play-in | on entry |
| 6-9 | playoff round | one game every 1.5 s |
| 10 | recap | on entry |

Every stage ends at a checkpoint. At a checkpoint, present participants ready; the stage advances when every
present participant is ready, or when the host advances alone. Away (unseen for 60 s) and left participants
never block. The host role moves to the earliest joined present participant when the host is away for 45 s or
leaves.

`POST /ready` and `POST /advance` carry an action id and the expected stage. A retry of the same action id, or a
request carrying an old stage, returns the current view without moving the checkpoint twice. The same
idempotency applies to draws, rerolls, builds, start, lock and rematch.

The view only reveals what the cursor allows:

- regular games only up to the revealed game number;
- partial standings derived from revealed games only;
- seeds and awards only from the awards stage;
- play-in only from the play-in stage;
- playoff games only up to the round cursor; a series winner appears only when the whole series is revealed;
- the champion and every finish only in the recap.

## Modes

- **Normal**: the classic 10-trait builder. The assigned team replaces the team spin.
- **Salary Cap**: one seeded board per lobby (`infiniteGrid` from the lobby seed), one budget
  (`budgetForSeed`), one card per column. Participants choose different cards from the same board. The server
  recomputes the board and rejects cards that are not on it or a total over the cap.
- **Squad**: five 10-trait builds (PG, SG, SF, PF, C). The five become the assigned team's starting lineup
  through `squadStrength`.

## API

All handlers are Web-standard functions under `api/lobby/**` and send the participant secret as
`authorization: Bearer <32 hex chars>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/lobby` | create a lobby; the creator hosts seat 1 |
| GET | `/api/lobby/:code?since=&events=&token=` | poll the view (204 when unchanged, delta when only progress moved) |
| POST | `/api/lobby/:code/join` | take a free seat; the same secret resumes the same seat |
| POST | `/api/lobby/:code/start` | host: `lobby` to `draw` with the chosen mode and era |
| POST | `/api/lobby/:code/draw` | draw a unique unclaimed team |
| POST | `/api/lobby/:code/reroll` | one reroll into a still-unclaimed team |
| POST | `/api/lobby/:code/lock` | host: lock assignments and open building |
| POST | `/api/lobby/:code/build` | validate and store a Normal, Salary or Squad build |
| POST | `/api/lobby/:code/ready` | ready at the current checkpoint |
| POST | `/api/lobby/:code/advance` | host or all-ready: move to the next checkpoint |
| POST | `/api/lobby/:code/rematch` | host: keep people and code, reset to the team draw |
| POST | `/api/lobby/:code/leave` | leave; before the draw the seat is deleted, after it is marked left |

Every POST carries a client action id. `actions (participant_id, action_id)` is the idempotency ledger.

Errors use `{ error, reason }` with `not_found` (404), `full` (409), `started` (409), `forbidden` (403),
`conflict` (409), `invalid` (400) and `server` (503).

## Database

`db/schema.sql` is additive: `create table if not exists` and `add column if not exists`. Run
`npm run db:migrate`.

- `lobbies` keeps mode, era, the computed league JSON, the stage/cursor, `season_secret` and the rematch count.
- `participants` keeps the seat, the build, its summary and the ready markers.
- `lobby_teams` enforces one team per participant and one participant per team.
- `league_games` stores one result per matchup.
- `events` is the activity feed; `actions` is idempotency.

`npm run prune:lobbies -- <hours>` deletes lobbies idle for longer than the window (default 24).

## Transport and privacy

The client polls every second while visible and every five seconds while hidden, and re-fetches after its own
actions. The view exposes names, seats, teams, build summaries, revealed results and the last 30 events. It
never exposes another participant's secret, token hash, participant id or full build. A lobby is reachable only
by code. Names are trimmed to 16 characters and control characters are removed.

## Tests

- `tests/league.test.ts` — deterministic engine invariants: 82 games per team, schedule symmetry, one result per
  matchup, tiebreakers, seeds, play-in and bracket consistency, and no result beyond the reveal cursor.
- `tests/league-api.test.ts` — complete 8-player leagues through the handlers in normal, salary and squad,
  including unique draws and rerolls under concurrency, idempotent checkpoints, away players not blocking, identical
  views for every participant, and rematch.
- `tests/mp-*.test.ts` — codes, progress, format, draft and error handling.

## Known limits

- Identity is one secret per device. A second device is a new participant.
- The transport is HTTP polling.
- Creating and joining are not rate limited beyond the code.
- Stale lobbies are pruned by `npm run prune:lobbies`.
- Salary Cap powers (column shuffle, row shuffle, scout) are not enabled on the shared lobby board yet; the
  board and budget are shared, and participants choose from the same cards.
