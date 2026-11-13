# Salary Cap

A 5x5 grid of players priced $10M to $50M per column (Finishing, Shooting, Defense, Playmaking, Size). The player takes one card per column under the day's cap, then gets a build and a seeded season. The daily grid is one attempt per day; Infinite mode replays with fresh grids.

## Sub-features

- `salary-grid` shows the date, the cap and 25 priced cards.
- `salary-budget` keeps the running total and blocks confirming over the cap.
- `salary-lock` shows "Already played today" after the daily run.
- `salary-infinite` plays unlimited local grids.

## How to get to it (user POV)

- Home row `Salary Cap` (`home-salary`); the header toggle (`salary-mode`) switches DAILY/INFINITE.

## Driving it with control.mjs

Preconditions:

- Fresh session.

- **Grid.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature salary --session s1 --step 'click:css:[data-testid="home-salary"]' --step 'see:css:[data-testid="salary-grid"]' --step overflow --step shot:grid`.
- **Daily run.** Add `click:css:[data-testid^="salary-finishing-"] >> nth=4` and the same for `shooting`, `defense`, `playmaking`, `size` (the $10M row), then `click:css:[data-testid="salary-confirm"]`, `see:css:[data-testid="salary-result"]`, `shot:result`.
- **Lock.** `--step reload --step 'click:css:[data-testid="home-salary"]' --step 'see:text:Already played today'`.
- **Infinite.** `--step 'click:css:[data-testid="salary-mode"]' --step 'see:text:INFINITE'`, pick five cards again, confirm, `see:css:[data-testid="salary-result"]`.

## Gotchas

- The daily grid is generated locally from the date with the original's generator; the original stores its grid in its own database, which we never read. The supervisor compared 2026-11-13: 25/25 cards and the $130M cap matched.
- Picking the $50M row in every column exceeds any cap; confirm stays disabled.
