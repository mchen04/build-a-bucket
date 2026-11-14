# Offline playing modes

Three of the original's offline modes are rebuilt next to the classic builder: the Daily Challenge, Salary Cap
(daily and infinite) and the Squad Builder. All three reuse the shared engine (`src/shared/engine`), the classic
builder screen and the classic spin rules, and the seeded parts reproduce the original's own algorithm. They read
the same runtime catalog as the classic run (pinned data, kept in the Cache API as `bab-data-v1`).

## Daily Challenge

- Day key: the America/New_York date `YYYY-MM-DD` (`newYorkDayKey`); the seed is `bap-daily-<date>`.
- Sport by day: from 2026-10-23 the sport alternates daily; `s = floor(days/2)` picks the position
  (`guard`/`big`) and the era (`classic` each two days, then `all-time`). Even days are football days, which
  this rebuild does not play; the screen says so and points at the next basketball day.
- One run per day per device, in our own versioned key `bab:daily:v1`
  (`{v:1, days: {<date>: {key, spins, done, forfeit, ovr, run}}}`), the equivalent of the original's
  `bab_daily_run` plus `progress.dc`.
- Resuming: the run is written after every spin, so a reload returns straight to the run. Leaving mid-run
  forfeits the day (the leave button asks first, exactly as the original warns).
- The spins are the classic seeded spins from `bap-daily-<date>`, so every device gets the same reels. The
  season itself is unseeded, as in the original, so results differ per player; the day's OVR is kept locally
  because posting needs login in the original.

## Salary Cap

- Columns and prices: `SAL_COLUMNS` and `SAL_TIERS` (50/40/30/20/10M); one card per column, total ≤ cap.
- Cap: `[130,140,150,160,170][hash(seed ^ 0xB0B0B0)]`, with the original's fixed overrides for 2026-07-15/16/17.
  The daily seed is the date as `YYYYMMDD`; infinite runs use a random 31-bit seed.
- Board: two legend slots a day (the legends are shuffled once with the fixed `0xBADC0FFE`, then indexed by
  the day number), every other cell drawn from its rank band of the column mean, yesterday's picks marked down
  3.5, names never reused inside a day. `dailyGrid` and `infiniteGrid` in `src/shared/engine/salary.ts`.
- Play: the guards' column types are read from the pick, the big types back them up, and
  basketballIQ/clutch/rebounding are the mean of the picks' full attributes. Position comes from the
  size-column card; the team is `catalog.teams[hash(seed)]`; the season runs with the numeric seed.
- Storage: `bab:salary:v1` keeps the played daily boards (a day is locked once played) and an infinite counter.
- The original reads and upserts its own Supabase `salary_cap_grids` board; we never touch that database and
  generate the board locally. If the original's live row for a day was written by someone else first, or is
  one of the hard-coded boards for 2026-07-15..18, our board can differ — recorded as a limitation, not hidden.

## Squad Builder

- Five slots (`SQUAD_SLOTS`): three guards (PG, SG, SF) and two bigs (PF, C). Each slot is built with the
  normal builder spins, then the squad picks a team and plays one season.
- Strength: the team's rating moves by the builds that beat out its weakest starters,
  `off += Δ·0.45` for guards and `Δ·0.25` for bigs, `def += Δ·0.15` / `Δ·0.35`, clamped to 40..99.
- Season: seeded with `${squad.seed}-season-${n}` through the original's record simulation (82 games,
  standings, play-in, best-of-seven rounds, the all-time league offset for all-time pools).
- Honours: composite `ppg + 1.2·rpg + 1.5·apg + 2·(spg+bpg) + 0.08·(wins−41)` with the original's
  thresholds 50/45/41/35, at most two All-NBA and four honours.
- Storage: `bab:squad:v1` keeps the seed, the slots' runs, the team and the last result.

## Parity harness

`node .claude/skills/verify-build-a-bucket/scripts/parity/run.mjs --seeds 50` executes the
original's own code as an oracle and compares it with our engine on the same seeds and inputs (the harness
registers its own module hooks before importing our TypeScript engine). The harness downloads the original's
public source at `92cb2a155bb2261cd68038ac366b994ad5dbb873` into a cache outside the repo
(`~/.cache/bab-parity`, `BAB_PARITY_CACHE` to move it) and runs it unmodified in a child process through
`.claude/skills/verify-build-a-bucket/scripts/parity/hooks.mjs`; component-inline logic (spin targets, the salary
score line and build, the shuffle derangements, the cap table) is cut from the original's source text by
`oracle-batch.mjs` and evaluated with a seeded `Math.random`. Nothing of the original is vendored into the repo.

Areas compared, and the fields that decide them:

| Area | Compared |
|---|---|
| `spin` | 10 spins per seed: team, dealt player, player respin, the team reel, pool size |
| `ovr` | OVR and archetype for a fixed guard and a fixed big build |
| `daily` | the day's plan (sport, position, mode, seed), the day's spins, and the OVR of the dealt build |
| `season` | record, conference seed, win-probability table (`teamWP`), stat line, MVP/DPOY flags, play-in and playoff rounds |
| `salary` | board generator (including the four fixed boards), budgets, yesterday seed, infinite board, team pick, score line and the build the picks produce |
| `powers` | column shuffle, row shuffle and scout grades, all on a seeded draw |
| `squad` | strength, record, seed, rounds, finals and champion |

Last full run (2026-11-13, `--seeds 50`): 14,265 fields compared across the seven areas, 0 mismatches.

`tests/parity-oracle.test.ts` enforces the same comparison offline in CI against the recorded oracle outputs in
`tests/fixtures/oracle/*.json` (8 seeds per area, plus a pooled data snapshot). Regenerate them with
`--write-fixtures`.

Not compared, or intentionally different:

- Per-player squad honours. The original rolls squad stat lines inside `runSquadSeason`; our app derives the
  honour chips from a fixed-seed stat roll, so per-player honours differ. Team results (record, seed, rounds,
  finals, champion) are compared and match.
- The original's server-side salary check (`verifyCore.checkSalaryCap`) computes a different "overall" from the
  screen's score line; only the screen's score line and the build the picks produce are compared.
- Season win probability itself: the original's result object does not expose it, so `teamWP` for all thirty
  teams plus the simulated record and rounds stand in for it.
- Season moments, and the shared-league adaptation, are covered in `docs/MULTIPLAYER.md`, not here.

The comparison is a sample, not a proof: `--seeds N` covers N seeds per area.

## Known limits

- Football (NFL) daily days are not rebuilt, so a football day shows a visible limitation.
- Salary Cap powers (column shuffle, row shuffle, scout) are rebuilt and match the original's derangements and
  grades for a seeded draw; the shuffle is spent once per board, as in the original.
- The original's posting and boards need login and its own service; results stay on the device.
- Squad Builder box scores come from our engine's stat model; the strength, record, seed, playoff run and the
  honour composite and thresholds follow the original's algorithm.
