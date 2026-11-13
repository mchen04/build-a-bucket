# Single-player Play

The player spins ten times for NBA players, takes one trait from each into an empty slot, spins for a team, simulates an 82-game season with two-option Moments, plays the playoffs if seeded, and reads a final report. The run survives a reload at every step.

## Sub-features

- `play-start` starts from the home screen with the chosen position and era.
- `play-pick` offers every still-empty trait after a spin and blocks filled ones.
- `play-resume` restores a partial build after reload.
- `play-team` spins a team once all ten slots are filled.
- `play-season` simulates a season and pauses for Moments.
- `play-playoffs` reveals the playoff run for a seeded team.
- `play-report` shows the real OVR, archetype, line and awards, also after reload.

## How to get to it (user POV)

- Home: choose `Guard`/`Big` and `Current`/`All-Time`, then the bottom button `Play · Guard · Current`.
- Reopening the app resumes a run in progress.

## Driving it with control.mjs

Preconditions:

- Doctor ok; fresh session.

- **Start and pick.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature play --session p1 --step 'click:button:/^play/' --step spinpick:4 --step shot:four-picks`. Four `.slot.filled` rows, each with a source player name.
- **Resume.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature play --session p1 --step 'see:css:.slot.filled' --step shot:resumed --step storage:partial`. The same four slots are back; the storage dump holds the run.
- **Finish the build.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature play --session p1 --step spinpick:10 --step 'see:text:All 10 slots filled' --step overflow --step shot:build-complete`.
- **Team and season.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature play --session p1 --step 'click:button:Spin for Team' --step 'click:css:.spin-big' --step 'click:button:Simulate Season' --step 'see:text:Record' --step season --step overflow --step shot:season-result`. The `season` step reports how many Moments it answered (two or three, as `docs/PROVENANCE.md` records).
- **Playoffs and report.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature play --session p1 --step 'click:css:.bottom .btn' --step 'repeat:2|click:button:Skip to Result' --step 'repeat:1|click:button:See Results' --step 'see:css:[data-testid="ovr"]' --step overflow --step shot:report --step reload --step 'see:css:[data-testid="ovr"]' --step shot:report-after-reload`. The banner reads one of NBA CHAMPIONS, LOST THE ..., OUT IN THE ..., MADE THE PLAYOFFS or MISSED THE PLAYOFFS; OVR is not 0 and the archetype is not `Spin to start building`.

## Gotchas

- A spin can land on a player with nothing left to give; the screen says so and the only move is to spin again (`spinpick` retries up to 6 times).
- Moments are off when the `bap_moments_off`-equivalent setting is on; then `season` reports 0.
- `GRADES` toggles letter grades and numbers and persists; assert slot values with the current mode in mind.
