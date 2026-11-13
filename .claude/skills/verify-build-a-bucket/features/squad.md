# Squad Builder

Five builds, one per slot (PG, SG, SF as guards; PF, C as bigs), each made with the normal builder, then one team pick and a seeded season for the whole squad with per-player lines and honours.

## Sub-features

- `squad-slot` builds one slot with the normal builder and adds it to the squad.
- `squad-persist` keeps filled slots after reload.
- `squad-season` simulates the squad season once all five are filled and a team is chosen.
- `squad-redo` rebuilds one slot.

## How to get to it (user POV)

- Home row `Squad Builder` (`home-squad`), then a slot button `squad-build-<PG|SG|SF|PF|C>`.

## Driving it with control.mjs

Preconditions:

- Fresh session. A full squad takes five complete builds (about 1 minute).

- **One slot.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature squad --session q1 --step 'click:css:[data-testid="home-squad"]' --step 'click:css:[data-testid="squad-build-PG"]' --step spinpick:10 --step 'click:button:Add to squad' --step 'see:css:[data-testid="squad-slot-PG"]' --step shot:pg`.
- **All slots.** Repeat for SG, SF, PF and C in the same session, then `--step reload --step 'click:css:[data-testid="home-squad"]' --step overflow --step shot:ready`.
- **Season.** `--step 'click:css:[data-testid="squad-team"] .team-btn' --step 'click:css:[data-testid="squad-simulate"]' --step 'see:text:SEED' --step overflow --step shot:result --step storage:squad`.

## Gotchas

- `e2e/modes.spec.ts` writes four of the five slots into storage to save time; only this recipe proves all five through the UI.
- Per-player box scores are our own formula (see docs/MODES.md); only the record, seed and playoff run are proven equal to the original.
