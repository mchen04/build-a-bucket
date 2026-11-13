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

Golden tests live in `tests/daily.test.ts`, `tests/salary.test.ts` and `tests/squad.test.ts`. They pin the daily
mapping and spins, the cap per date, two daily boards, the team pick, and a squad's strength, record, seed,
playoff run and honours for a fixed squad. Expected values were transcribed from the original's own algorithms
read at commit `92cb2a155bb2261cd68038ac366b994ad5dbb873`; the original's code is never executed.

## Known limits

- Football (NFL) daily days are not rebuilt, so a football day shows a visible limitation.
- Salary Cap powers (column shuffle, row shuffle, scout) are not rebuilt; they only rearrange local views.
- The original's posting and boards need login and its own service; results stay on the device.
- Squad Builder box scores come from our engine's stat model; the strength, record, seed, playoff run and the
  honour composite and thresholds follow the original's algorithm.
