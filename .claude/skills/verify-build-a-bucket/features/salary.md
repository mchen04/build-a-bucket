# Salary Cap

A 5x5 grid of players priced $10M to $50M per column (Finishing, Shooting, Defense, Playmaking, Size). The player takes one card per column under the day's cap, then gets a build and a seeded season. The daily grid is one attempt per day; Infinite mode replays with fresh grids.

## Sub-features

- `salary-grid` shows the date, the cap and 25 priced cards.
- `salary-budget` keeps the running total and blocks confirming over the cap.
- `salary-lock` shows "Already played today" after the daily run.
- `salary-infinite` plays unlimited local grids.
- `salary-powers` (`salary-powers`) opens a small menu with SHUFFLE and SCOUT, each showing a badge with uses left (1 then 0); a used power is greyed and disabled, and both are disabled once the day's result is locked.
- `salary-shuffle` (`salary-power-shuffle`) arms a target on every column header (`salary-shuffle-column-<key>`) and every price row (`salary-shuffle-row-<tier>`). One use covers one column or one row: the column's players are deranged so none keeps its row and each takes its new row's price, or the row's players move across columns; picks in the changed column are cleared, and the result is scored on the shuffled board.
- `salary-scout` (`salary-power-scout`) reveals one card's grade (`salary-scout-hint`); the hint stays on the card.
- Powers are one use per daily puzzle, remembered per day across reloads; Infinite starts each run with both powers fresh.
- An armed power can be cancelled (`salary-power-cancel`) without spending it; arming resets when the day locks, and in Infinite the powers are disabled once that run's result is shown.
- The build's position comes from the SIZE pick: a big in the size column simulates as a big.

## How to get to it (user POV)

- Home row `Salary Cap` (`home-salary`); the header toggle (`salary-mode`) switches DAILY/INFINITE.

## Driving it with control.mjs

Preconditions:

- Fresh session.

- **Grid.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature salary --session s1 --step 'click:css:[data-testid="home-salary"]' --step 'see:css:[data-testid="salary-grid"]' --step overflow --step shot:grid`.
- **Daily run.** Add `click:css:[data-testid^="salary-finishing-"] >> nth=4` and the same for `shooting`, `defense`, `playmaking`, `size` (the $10M row), then `click:css:[data-testid="salary-confirm"]`, `see:css:[data-testid="salary-result"]`, `shot:result`.
- **Lock.** `--step reload --step 'click:css:[data-testid="home-salary"]' --step 'see:text:Already played today'`.
- **Infinite.** `--step 'click:css:[data-testid="salary-mode"]' --step 'see:text:INFINITE'`, pick five cards again, confirm, `see:css:[data-testid="salary-result"]`.
- **Powers.** `--step 'click:css:[data-testid="salary-powers"]' --step 'see:css:[data-testid="salary-powers-menu"]' --step 'see:text:SHUFFLE' --step 'click:css:[data-testid="salary-power-shuffle"]' --step 'see:css:[data-testid="salary-shuffle-column-shooting"]' --step 'click:css:[data-testid="salary-shuffle-column-shooting"]' --step 'click:css:[data-testid="salary-powers"]' --step 'see:text:0'`; the badge reads 0 and the button is disabled. Reload and reopen the game: both badges still read 0 after a shuffle or scout. Then `--step 'click:css:[data-testid="salary-power-scout"]' --step 'see:css:[data-testid="salary-scout-hint"]'`.

## Gotchas

- The daily grid is generated locally from the date with the original's generator; the original stores its grid in its own database, which we never read. The supervisor compared 2026-11-13: 25/25 cards and the $130M cap matched.
- Picking the $50M row in every column exceeds any cap; confirm stays disabled.
- Shuffling a column clears that column's pick, so the cap total drops by that card's price.
- Only today's powers are kept; saving a new day drops the older entries.
