# Shared multiplayer league

One server-authoritative NBA league for 2 to 8 friends, backed by Neon Postgres and Vercel functions. Every
friend replaces a different NBA team; the other teams are computer controlled. The same schedule, results,
standings, seeds, awards and champion are shown to every participant.

Single-player modes are unchanged. A lobby never reads or consumes the solo Daily allowance.

## Flow

| Phase | Who moves it | What the lobby sees |
|---|---|---|
| `lobby` | host starts (2+ players) | invite link, seats, mode and era |
| `draw` | each participant, host can lock | one unique team each, one respin, unclaimed pool |
| `building` | each participant, host can lock now | Normal, Salary Cap or Squad builder for the assigned team |
| `preview` | everyone readies, host can start | every team with its build OVR |
| `season` | the server reveals | four quarter checkpoints, scores, partial standings |
| `awards` | everyone readies, host can advance | final standings and awards |
| `playin` | everyone readies, host can advance | play-in results |
| `playoffs` | the server reveals game by game | first round, semis, conference finals, finals |
| `recap` | host starts a rematch | champion, every finish, friend head-to-head |
| `rematch` | every retained participant readies | the next game's readiness gate |

The host chooses one mode (`normal`, `salary`, `squad`) and one era (`current`, `alltime`). The mode and era are
fixed for the league; a rematch keeps them and the same seats and code.

A league needs at least two retained players. A new participant can join only in `lobby`; an existing secret can
reconnect in any phase and keeps its seat, team, build and powers.

## Team assignment

`lobby_teams` has one row per human participant with `primary key (lobby_id, participant_id)` and
`unique (lobby_id, team)`. The database, not the application, is the authority on uniqueness.

- A draw picks a random team from the pool that has no row for this lobby. The lobby row is locked for the
  statement, so concurrent draws serialize.
- A respin is allowed once per participant per game. The update is guarded by `not reroll_used` and excludes the
  current team. A retried request with the same action id returns the stored row and never spends a second respin.
  A rematch deletes the team rows, the league slices and the `league` column, so the next game starts with a
  fresh draw, build and respin.
- Assignments lock when the host starts building (`locked_at`) or 15 seconds after the last present participant
  draws, whichever comes first. The window gives the last drawer the same reroll chance as every earlier drawer.
  The host can lock early; participants who have not drawn receive a team from the server first. The lock
  statement draws every missing team and moves the phase in one `for update` statement, so a player can never
  enter `building` without a team.
- A reconnect with the same secret resumes the same seat, team and respin state. A participant who left after the
  draw rejoins with a cleared build, readiness and salary powers, so the previous game's build cannot be played
  again and cannot count as ready for a rematch.

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
- The computed `LeagueResult` is the single source of truth in `lobbies.league`. There is no second game table.

## Team strength and the adapted formulas

The solo engines remain the source for ratings, stats, awards and series probabilities. The shared league needs
one extra step the solo simulations never needed: a game between two separately rated teams.

- Normal and Salary builds use `ovrFromValues` for the player OVR. The human team's win probability is
  `winProbFor(ovr, team, era)` from `src/shared/engine/season.ts` (the solo formula).
- Squad's five builds use `squadStrength(team, starters, builds, era)` from `src/shared/engine/squad.ts`;
  the human team's win probability is the squad season's `0.2 + ((off+def)/200 - 0.59)/0.24 * 0.57` curve,
  compressed toward 0.5 by 0.8 in the current era.
- A CPU team uses `winProbFor(82, team, era)`: the same curve, the same current-era compression and the same
  clamps as a human with a neutral OVR. Human and CPU teams therefore sit on one strength scale; a human
  replacing a team is not systematically stronger or weaker than the CPU version of that team.
- Two teams meet with the squad engine's matchup adaptation:
  `raw = (a - a*b) / (a + b - 2*a*b)`, `p = 0.5 + (raw - 0.5) * 1.12`, clamped 0.15..0.85. The home side gets
  +0.02 for home court. Scores reuse the solo 94-116 base and 3-19 margin.
- Regular-season standings use wins, then the NBA multi-team tiebreak: combined head-to-head among the tied
  teams, then conference record, then a seeded coin derived from the league seed and the team. Seeds 1-6 go
  straight to the playoffs; 7-10 play the play-in.
- The play-in is the solo bracket shape (7v8, 9v10, loser of 7v8 hosts the 9/10 winner). The playoffs are a
  16-team bracket (1v8, 4v5, 3v6, 2v7 in each conference), best-of-seven with the 2-2-1-1-1 home pattern.
  A series game's RNG is keyed by the seed, series id and game index. Later rounds reseed by the winner's
  actual seed, not the bracket slot's seed.
- Awards reuse the solo award score (`ppg + 1.5*apg + 0.75*rpg`, the MVP benchmarks, the DPOY score and
  threshold). A human wins only by beating the benchmark; otherwise a computer star from the display pools wins.
  The human stats come from `rollStats(values, position, seededRng(seed:participant))`.
- The recap's head-to-head counts every game the two friends played, including play-in and playoff games.

These are intentional adaptations, not solo parity claims: solo seasons simulate one team against simulated
opponents, while this league simulates one 1,230-game schedule with one authoritative result per matchup.

## Reveal and pacing

`lobbies.stage` is the checkpoint index and `lobbies.stage_cursor` is how much of the current stage has been
revealed. `stage_started_at` drives the automatic reveal. Cursor writes use `greatest(stage_cursor, ...)`, so a
slower poll can never move the reveal backwards.

| Stage | Contents | Reveal |
|---|---|---|
| 0-3 | regular-season quarters | a batch of 3 games every 1.2 s |
| 4 | awards and final standings | on entry |
| 5 | play-in | on entry |
| 6-9 | playoff round | one game every 1.5 s |
| 10 | recap | on entry |

Every stage ends at a checkpoint. At a checkpoint, present participants ready; the stage advances when every
present participant is ready, or when the host advances alone. Away (unseen for 60 s) and left participants
never block. If the host is present but has not readied 90 seconds after the checkpoint opened, any present
participant may advance once everyone except the host is ready, and the server advances on the next poll. A
player who is still reading inside those 90 seconds is never skipped. The host role moves to the earliest joined
present participant when the host is away for 45 s or leaves.

`POST /ready` and `POST /advance` carry an action id and the expected stage. A retry of the same action id, or a
request carrying an old stage, returns the current view without moving the checkpoint twice. Every phase
transition uses a row lock or an atomic compare-and-set, so concurrent ready/advance/rematch/build/draw/reroll/
lock requests cannot skip, double-apply or move the cursor backwards.

The view only reveals what the cursor allows:

- regular games only up to the revealed game number;
- partial standings derived from revealed games only;
- seeds and awards only from the awards stage;
- play-in only from the play-in stage;
- playoff games only up to the round cursor; a series winner appears only when the whole series is revealed;
- the champion and every finish only in the recap.

`stageTotal` is a fixed denominator: the real quarter size for stages 0-3, 6 for the play-in, and 7 per series
for a playoff round. It never exposes how long a series actually ran.

## Building and the rematch gate

- Normal and Squad spins are derived from a per-participant server seed (`buildSeed` in the view). The client
  records the spin history and the server replays it, rejecting any pick the sequence could not produce. Squad
  slots must match the solo position rules (PG/SG/SF guard, PF/C big).
- Salary Cap uses one seeded board and budget per lobby. Each participant may use one Shuffle and one Scout,
  exactly as in solo Salary Cap. Powers are stored per participant, are idempotent on retry, survive reconnect
  and reset on a rematch. The server validates every card against that participant's board and the cap.
- During `building`, the host may lock after every present participant has submitted, or at any time with
  "lock now". Any retained participant without a finished build keeps their team and gets a deterministic
  auto-completed build from the server seed. The view marks it `auto` and the lobby says so; nobody is silently
  turned into a CPU team.
- Play Again keeps the lobby, code and participants, clears builds, teams, powers and readiness, and moves to
  `rematch`. The next game starts only after every retained participant readies. The host cannot bypass this
  gate; a participant who leaves stops counting, and the host may remove an away player (which counts as
  leaving). An unready participant is never silently marked ready. If fewer than 2 remain, the rematch gate
  shows "A league needs at least 2 players" and the invite link; the host can share it or close the lobby.
- Every rematch gets a new `season_secret`, so the schedule, results, Salary board and build seeds are new.

## Modes

- **Normal**: the classic 10-trait builder. The assigned team replaces the team spin.
- **Salary Cap**: one seeded board per lobby (`infiniteGrid` from the lobby seed), one budget
  (`budgetForSeed`), one card per column. Participants choose different cards from the same board, with the
  solo Shuffle and Scout powers.
- **Squad**: five 10-trait builds (PG, SG, SF, PF, C). The five become the assigned team's starting lineup
  through `squadStrength`.

## Invite links

The primary invite action copies a full URL such as `https://build-a-bucket.vercel.app/j/ABC234`. Opening it
goes straight to a name-only join screen; a device with a saved session for that code reconnects instead of
joining twice. `?join=ABC234` is also accepted. Manual code entry remains on the home screen. Missing, full and
already-started lobbies each return a short message. `vercel.json` rewrites `/j/*` to the app shell.

## API

All handlers are Web-standard functions under `api/lobby/**` and send the participant secret as
`authorization: Bearer <32 hex chars>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/lobby` | create a lobby; the creator hosts seat 1 |
| GET | `/api/lobby/:code?since=&events=&token=` | poll the view (204 when unchanged, delta when only progress moved) |
| POST | `/api/lobby/:code/join` | take a free seat in `lobby`; the same secret resumes any phase |
| POST | `/api/lobby/:code/start` | host: `lobby` to `draw` with the chosen mode and era (2+ players) |
| POST | `/api/lobby/:code/draw` | draw a unique unclaimed team |
| POST | `/api/lobby/:code/reroll` | one respin into a still-unclaimed team |
| POST | `/api/lobby/:code/lock` | host: draw any missing teams, lock assignments and open building |
| POST | `/api/lobby/:code/build` | validate and store a Normal, Salary or Squad build |
| POST | `/api/lobby/:code/power` | one Salary Shuffle or Scout for this participant |
| POST | `/api/lobby/:code/ready` | ready at the current checkpoint, preview or rematch gate |
| POST | `/api/lobby/:code/advance` | host or all-ready: move to the next checkpoint; host lock now; open the rematch draw |
| POST | `/api/lobby/:code/rematch` | host: keep people and code, reset to the rematch gate |
| POST | `/api/lobby/:code/remove` | host: remove an away player (counts as leaving) |
| POST | `/api/lobby/:code/leave` | leave; before the draw the seat is deleted, after it is marked left |

Every POST carries a client action id. `actions (participant_id, action_id)` is the idempotency ledger.

Errors use `{ error, reason }` with `not_found` (404), `full` (409), `started` (409), `forbidden` (403),
`conflict` (409), `invalid` (400) and `server` (503).

## Database

`db/schema.sql` is additive: `create table if not exists`, `add column if not exists`, and widened check
constraints that accept both the old and new phase/status values. Run `npm run db:migrate`.

- `lobbies` keeps mode, era, the computed league JSON, the stage/cursor, `season_secret` and the rematch count.
- `participants` keeps the seat, the build, its summary, the ready markers and `salary_powers`.
- `lobby_teams` enforces one team per participant and one participant per team.
- `events` is the activity feed; `actions` is idempotency.

The migration normalizes old lobbies deterministically: old `building` lobbies return to `lobby` with their
builds cleared, and old `season`/`barrier`/`playoffs`/`finished` lobbies become read-only `recap` lobbies that
the host can rematch. Old participant statuses become `joined`. The old write-only `league_games` table is
dropped; the league JSON is the single source of truth. `tests/migration.test.ts` rehearses the migration on a
fresh copy of the old schema with old rows.

`npm run prune:lobbies -- <hours>` deletes lobbies idle for longer than the window (default 24).

## Transport and privacy

The client polls every second while waiting or at a checkpoint, every 1.5 s while a stage reveals, and every five
seconds while hidden; it re-fetches after its own actions. The view exposes names, seats, teams, build summaries,
revealed results and the last 30 events. It
never exposes another participant's secret, token hash, participant id or full build. A lobby is reachable only
by code. Names are trimmed to 16 characters and control characters are removed.

During a reveal the server reads the compact league slice keyed by lobby, stage and cursor: the meta row, one
checkpoint row and the games the view needs, not the full league JSON. An unchanged poll is answered 204 from the
cheap probe. The full `league` column is read only when the slice is missing (a lobby locked before the slice
migration).

## Tests

- `tests/league.test.ts` — deterministic engine invariants: 82 games per team, schedule symmetry, one result per
  matchup, multi-team tiebreakers, reseeding, seeds, play-in and bracket consistency.
- `tests/league-reveal.test.ts` — walks every stage and every participant (plus a spectator) and checks that
  every view field is derivable from revealed games only, including records, seeds, awards, series and recap.
- `tests/league-api.test.ts` — complete 8-player leagues in normal, salary and squad; unique draws and respins
  under concurrency; atomic checkpoints; host lock for players who never drew; server-authoritative spins,
  squad positions and salary cards; salary powers; auto-completed builds; the rematch gate, departures,
  repeated rematches and respin reset; reconnects; invite join errors.
- `tests/migration.test.ts` — applies the new schema to a fresh copy of the old schema with old rows.
- `tests/mp-*.test.ts` — codes, progress, format, draft, invite parsing and error handling.

## Known limits

- Identity is one secret per device. A second device is a new participant.
- The transport is HTTP polling.
- Creating and joining are not rate limited beyond the code.
- Stale lobbies are pruned by `npm run prune:lobbies`.
- The league JSON is read once per poll during a reveal; a normalized per-stage read is not implemented.
