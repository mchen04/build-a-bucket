# Daily Challenge

Everyone gets the same seeded spins for the New York date, with position and era set by the day. One run per device per day: no reset, and leaving mid-run ends the day. The result card shows the OVR (the original ranks the daily by OVR).

## Sub-features

- `daily-card` shows today's date, position and era, and the seed `bap-daily-<date>`.
- `daily-resume` restores a partial daily run after reload.
- `daily-lock` shows today's result and no play button after finishing, also after reload.
- `daily-football` on football days in the original's rotation, shows that the day is not a basketball day.

## How to get to it (user POV)

- Home row `Daily Challenge` (`home-daily`), then `Play Daily` / `Resume Daily` (`daily-play`).

## Driving it with control.mjs

Preconditions:

- Fresh session; today is a basketball day (`daily-card` visible, `daily-nfl` absent).

- **Open.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature daily --session d1 --step 'click:css:[data-testid="home-daily"]' --step 'see:css:[data-testid="daily-card"]' --step overflow --step shot:card`.
- **Play and resume.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature daily --session d1 --step 'click:css:[data-testid="home-daily"]' --step 'click:css:[data-testid="daily-play"]' --step spinpick:2 --step reload --step 'see:css:[data-testid="daily-strip"]' --step shot:resumed`. Two slots remain filled.
- **Finish.** Continue with `spinpick:10`, `click:button:Spin for Team`, `click:css:.spin-big`, `click:button:Simulate Season`, `season`, `click:css:.bottom .btn`, `repeat:2|click:button:Skip to Result`, `repeat:1|click:button:See Results`, `shot:end`.
- **Lock.** `--step 'goto:/' --step 'click:css:[data-testid="home-daily"]' --step 'see:css:[data-testid="daily-result"]' --step 'gone:css:[data-testid="daily-play"]' --step storage:locked`.
- **Same spins for everyone.** Run "Play" in two fresh sessions and compare the first chip's player in `shot` aria files: they match.

## Gotchas

- The day flips at midnight New York time, which is 21:00 in Los Angeles.
- Every run uses up the day for that session; use a new `--session` to replay.
