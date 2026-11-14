# Parity with the original

The engine is a port of the original game, not a fresh design. This harness runs the original's own code (at a pinned
commit) beside ours on the same inputs and reports every field that differs. It needs network once to fetch the
original source; after that the cache and the recorded fixtures let the comparison run offline.

## Sub-features

- `parity-engine` compares OVR, spin order, Daily plans, Salary grids and budgets, salary powers, the season
  (records, seeds, awards, playoff rounds) and the Squad season field by field.
- `parity-fixtures` records the original's output for a seed set in `tests/fixtures/oracle/`; `parity-oracle.test.ts`
  replays those fixtures without the original source or the network.
- `parity-areas` lets one area run alone (`--area season,salary`) while the full sweep stays the default.

## How to get to it (user POV)

- Not a screen. This is the check behind every rules claim in `docs/PROVENANCE.md` and `docs/MODES.md`.

## Driving it with control.mjs

Preconditions:

- Repository dependencies installed; network for the first fetch of the original at the pinned SHA.

- **Full sweep.** `node .claude/skills/verify-build-a-bucket/scripts/parity/run.mjs --seeds 20`.
  The harness registers its own module hooks before importing `ours.ts`, so plain `node` resolves the
  TypeScript sources. Each area prints
  `name: N fields, 0 mismatches`; the command exits non-zero if any area differs or an oracle fails.
- **One area.** `node .claude/skills/verify-build-a-bucket/scripts/parity/run.mjs --seeds 5 --area season,salary`.
- **Offline replay.** `npx vitest run tests/parity-oracle.test.ts` compares our engine with the recorded fixtures and
  needs no original source.
- **Re-record fixtures.** `node .claude/skills/verify-build-a-bucket/scripts/parity/run.mjs --seeds 50 --write-fixtures`.
  This rewrites `tests/fixtures/oracle/` and updates the pinned SHA where the harness reads it; keep the fixture diff
  in the same commit as the rule change it proves.
- **Cache.** `--cache <dir>` (or `BAB_PARITY_CACHE`) moves the fetched original source; the default is
  `~/.cache/bab-parity`.

## Gotchas

- The harness never touches a database, the dev server or the deployed app; it is a pure engine comparison.
- A fixture only proves the fields it recorded. New fields need a new oracle case, not a hand-written expectation.
- The original runs in a stubbed browser with network disabled; a case that needs a catalog passes the same pool we
  use.
- The pinned SHA is part of the evidence. If the original source moves, the comparison is against the recorded commit,
  not the latest one.
