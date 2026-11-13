# Build a Bucket (rebuild)

A faster, crash-free, mobile-first rebuild of the single-player Build a Bucket game. Ten picks with headshots
and grades, one 82-game season with the original's decision moments, play-in and playoffs, awards, and a final
report. Built with Vite, Preact and strict TypeScript.

This phase covers the single-player core only. Career, Salary Cap, Squad Builder and the live modes are shown
as "coming in this rebuild" placeholders; Blacktop, Compete and Versus need the original's live server and say
so on the home screen.

## Run

```
npm install
npm run dev
```

Open the printed URL. The app is designed for 390x844; each screen fits without vertical scrolling. The
GRADES toggle on the build screen switches trait letters for numbers and remembers the choice (`bap-hide-grades`),
and the MOMENTS toggle on the season screen turns the decision cards off (`bap_moments_off`).

## Test

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest: engine, spin, season, persistence, data loading
npm run build       # typecheck + production build
npm run e2e         # Playwright, iPhone 14 profile, headless
```

`npm run e2e` starts the dev server itself and runs both a WebKit iPhone 14 project and a Chromium Pixel 7
project. Screenshots are written to the turn folder outside the repo.
One vitest case loads the real data files from jsDelivr; set `BAB_SKIP_NETWORK=1` to skip it offline
(`BAB_SKIP_NETWORK=1 npm test`).

## Data

Player, team and headshot data are not stored here. The app loads them at runtime from the original's public
repository through jsDelivr, pinned to one commit (`DATA_SHA` in `src/shared/engine/rules.ts`), extracts the
exported literals and validates them with valibot. Rule constants and where each came from are listed in
`docs/PROVENANCE.md`.
