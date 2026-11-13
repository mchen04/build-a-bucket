# Build a Bucket (rebuild)

A mobile-first rebuild of the Build a Bucket game: ten picks with headshots and grades, a team spin, one 82-game
season with the original's decision moments, the play-in and the playoffs, awards and a final report. Built with
Vite, Preact and strict TypeScript. Player, team and headshot data are not bundled: they load at runtime from the
original's public repository through jsDelivr, pinned to one commit (`DATA_SHA` in `src/shared/engine/rules.ts`)
and kept in the Cache API (`bab-data-v1`) so a repeat visit skips the fetch.

## Modes and multiplayer

- **Play** — the classic ten-pick build, team spin, season and playoffs, resumable after a reload.
- **Daily Challenge** — the day's shared seeded spins; one run a day per device.
- **Salary Cap** — the day's five-column budget board, or an infinite board from a random seed.
- **Squad Builder** — five slots (PG, SG, SF, PF, C) sharing one seeded season.
- **Multiplayer** — one shared, server-authoritative NBA league for 2 to 8 friends over an invite code. Each
  friend draws a different team, builds for it in Normal, Salary Cap or Squad, and watches the same 82-game
  season, play-in and playoff bracket. Checkpoints pause for everyone present; a rematch keeps the group.

Every solo mode keeps its own versioned key (`bab:daily:v1`, `bab:salary:v1`, `bab:squad:v1`) and its seeded
output is pinned by golden tests. Rules, seeds and known limits are in `docs/MODES.md` and
`docs/MULTIPLAYER.md`.

## Run

```
npm install
npm run dev
```

Open the printed URL. The app is designed for 390x844 and fits every screen without vertical scrolling.
`npm run dev` also mounts the `api/` functions on the same port, so lobbies work locally: put the Neon branch in
`DATABASE_URL`, read from the gitignored `.env.local`, before creating one. `BAB_ENV_FILE` points that loader at
another file instead (`BAB_ENV_FILE=/dev/null` runs with no local env at all).

## Test

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest: engine, spin, season, persistence, data loading, lobby API
npm run build       # typecheck + production build
npm run e2e         # Playwright: iPhone 14 (WebKit) and Pixel 7 (Chromium), headless
```

`npm run e2e` starts the dev server itself. The lobby tests (vitest `tests/league-api.test.ts` and
`e2e/lobby.spec.ts`) need `DATABASE_URL` and skip themselves without it; the lobby spec is excluded from the CI
run. One vitest case loads the real data files from jsDelivr; `BAB_SKIP_NETWORK=1` skips it offline.
Playwright screenshots go to `test-results/shots/<spec>/`, or under `BAB_SHOTS` when set.

`.claude/skills/verify-build-a-bucket/` is the verification skill: `scripts/control.mjs` launches the stack,
drives the UI step by step with screenshots and aria snapshots as evidence, and measures cold load and the lobby
API under a full lobby. `features/` holds one recipe per feature.

## Deploy

Vercel serves the static app and the `api/` functions; Neon Postgres stores the lobbies. Set `DATABASE_URL` in
the Vercel project (never in the repository) and run `npm run db:migrate` once per database to apply
`db/schema.sql`.

## Limits

- Football daily days are not rebuilt; the screen says so and points at the next basketball day.
- Multiplayer is HTTP polling, identity is one secret per device, and neither creating nor joining a lobby is
  rate limited.
- `docs/MULTIPLAYER.md` and `docs/MODES.md` list the rest; `docs/PROVENANCE.md` records where every rule
  constant came from.
