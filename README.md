# Build a Bucket (rebuild)

A faster, crash-free, mobile-first rebuild of the single-player Build a Bucket game. Ten picks with headshots
and grades, one 82-game season with the original's decision moments, play-in and playoffs, awards, and a final
report. Built with Vite, Preact and strict TypeScript.

The single-player core is complete, and so are the Daily Challenge, Salary Cap (daily and infinite), Squad
Builder (`docs/MODES.md`) and Career (`docs/CAREER.md`) modes. Multiplayer is built as realtime lobbies for 2
to 8 players with invite codes, a host, live activity, a barrier before the playoffs and a shared reveal. The
original live modes (Blacktop, Compete, Versus) stay visible limitations.

## Modes

The home screen opens four ways to play. **Play** is the classic ten-pick build, season and playoffs.
**Daily Challenge** uses the day's shared spins (one run a day per device, resumable, leaving forfeits).
**Salary Cap** deals the day's five-column budget board or an infinite board from a random seed.
**Squad Builder** builds five slots (PG, SG, SF, PF, C) that share one seeded season. Each mode keeps its own
versioned key (`bab:daily:v1`, `bab:salary:v1`, `bab:squad:v1`) and the seeded outputs are covered by golden
tests; the details and the known limits are in `docs/MODES.md`.

**Career** builds a player, then runs the combine, the draft, seasons ten games at a time, injuries, form
swings, playoffs, awards, contracts, retirement and the Hall of Fame. Five save slots and the last twenty
finished careers live in `bab:career:v1` / `bab:career:history:v1`; the seeded rolls (draft, contracts,
injuries, swings, series odds) reproduce the original's for the same career seed and are covered by golden
tests. Its JavaScript is code-split, so opening the app does not pay for it. Advanced (3D) mini-games are a
visible limitation; simulated and a light simple mode are in. Details in `docs/CAREER.md`.

## Run

```
npm install
npm run dev
```

Open the printed URL. The app is designed for 390x844; each screen fits without vertical scrolling. The
GRADES toggle on the build screen switches trait letters for numbers and remembers the choice (`bap-hide-grades`),
and the MOMENTS toggle on the season screen turns the decision cards off (`bap_moments_off`).

`npm run dev` also mounts the `api/` functions on the same port, so lobbies work locally. Put `DATABASE_URL`
for the Neon dev branch in `.env.local` before you create a lobby.

## Multiplayer

One player creates a lobby, the others join with the 6 character code. The host picks the era and which builds
are allowed, then starts. Everyone builds at once, and the roster shows each player's filled count and latest
pick. The season runs on the server with moments off, then the lobby waits at the barrier for every present
player. Playoffs start together on one clock, and the lobby ends on a standings table. The API, the rules and
the known limits are in `docs/MULTIPLAYER.md`.

## Test

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest: engine, spin, season, persistence, data loading, lobby API
npm run build       # typecheck + production build
npm run e2e         # Playwright, iPhone 14 profile, headless
npm run db:migrate  # apply db/schema.sql to the Neon branch in .env.local
```

`npm run e2e` starts the dev server itself and runs a WebKit iPhone 14 project and a Chromium Pixel 7 project.
`e2e/career.spec.ts` plays a career from creation through several seasons to retirement, with a reload in the
middle and no vertical overflow at 390x844.
`e2e/lobby.spec.ts` drives eight browser contexts through a full lobby and runs on the Chromium project.
Screenshots are written to the turn folder outside the repo.
One vitest case loads the real data files from jsDelivr; set `BAB_SKIP_NETWORK=1` to skip it offline
(`BAB_SKIP_NETWORK=1 npm test`). The lobby tests talk to the real Neon dev branch and clean up every lobby
they create.

## Data

Player, team and headshot data are not stored here. The app loads them at runtime from the original's public
repository through jsDelivr, pinned to one commit (`DATA_SHA` in `src/shared/engine/rules.ts`), extracts the
exported literals and validates them with valibot. Rule constants and where each came from are listed in
`docs/PROVENANCE.md`.
