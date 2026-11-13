# Career

The player names a prospect, builds him with the normal builder, runs the combine and interviews, is drafted with a rookie deal, then plays seasons ten games at a time with injuries, form swings and playoff series, works through each offseason (training, contracts, trades) and finally retires to a legacy score and a Hall of Fame vote. Five save slots and a history of up to 20 finished careers persist locally and resume after reload.

## Sub-features

- `career-slots` lists five slots and the finished-careers history.
- `career-create` names the player and chooses the mini-game mode (off, simple; advanced is shown as unavailable).
- `career-draft` runs combine, interviews and draft day with a seeded pick and rookie deal.
- `career-season` advances a season in ten-game steps, handling injuries (sit or play through) and playoff rounds.
- `career-offseason` training camp, contract offers and talks, then the next season.
- `career-resume` restores the exact step after reload from its slot.
- `career-retire` retirement, legacy, Hall of Fame vote, the career in history; the Pro comeback shows as unavailable.

## How to get to it (user POV)

- Home row `Career` (`home-career`), then `New career` (`career-new`) or a slot's `Resume`.

## Driving it with control.mjs

Preconditions:

- Fresh session; mini-games set to off for a deterministic pace.

- **Create and build.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature career --session c1 --step 'click:css:[data-testid="home-career"]' --step 'see:css:[data-testid="career-slots"]' --step 'click:css:[data-testid="career-new"]' --step 'fill:css:[data-testid="career-first"]=>Ada' --step 'fill:css:[data-testid="career-last"]=>Vance' --step 'click:css:[data-testid="career-games-off"]' --step overflow --step 'click:css:[data-testid="career-start"]' --step spinpick:10 --step 'click:button:Enter the draft' --step 'see:css:[data-testid="career-combine"]' --step shot:combine`.
- **Combine, interviews, draft.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature career --session c1 --step 'click:css:[data-testid="home-career"]' --step 'click:css:[data-testid="career-slot-0"] button' --step 'click:css:[data-testid="career-drill-sprint"]' --step 'click:css:[data-testid="career-drill-lane"]' --step 'click:css:[data-testid="career-drill-spot"]' --step 'click:css:[data-testid="career-combine-done"]' --step 'see:css:[data-testid="career-interviews"]' --step 'repeat:1|click:css:[data-testid="career-answer-0-0"]' --step wait:300 --step 'repeat:1|click:css:[data-testid="career-answer-1-0"]' --step wait:300 --step 'repeat:1|click:css:[data-testid="career-answer-2-0"]' --step wait:300 --step 'repeat:1|click:css:[data-testid="career-answer-3-0"]' --step wait:300 --step 'click:css:[data-testid="career-interviews-done"]' --step 'see:css:[data-testid="career-pick"]' --step overflow --step shot:draft-day --step 'click:css:[data-testid="career-sign"]' --step 'see:css:[data-testid="career-preseason"]'`. Draft day names the team, round, pick and the rookie deal.
- **First season and resume.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature career --session c1 --step 'click:css:[data-testid="home-career"]' --step 'click:css:[data-testid="career-slot-0"] button' --step 'click:css:[data-testid="career-tipoff"]' --step 'click:css:[data-testid="career-advance"]' --step reload --step 'click:css:[data-testid="home-career"]' --step 'click:css:[data-testid="career-slot-0"] button' --step 'see:css:[data-testid="career-season"], [data-testid="career-injury"], [data-testid="career-bracket"]' --step shot:resumed --step 'until:[data-testid="career-recap"]|[data-testid="career-advance"],[data-testid="career-sit"],[data-testid="career-play-through"],[data-testid="career-round"]' --step overflow --step shot:recap --step storage:career`.
- **To retirement.** `e2e/career.spec.ts` plays eight or more seasons, retires and checks history; run it with `npm run e2e -- e2e/career.spec.ts`.

## Gotchas

- Every new `ui` call (and every reload) lands on home: re-enter with `home-career` then the slot's `Resume` (`career-slot-0` button). Finished careers move to `career-history`.
- Career rolls are seeded per career and year; the regular-season games themselves are not (as in the original), so records differ between runs.
- Interviews show one question at a time as `career-answer-<question>-<option>`; only the current question's buttons exist and answered options stay enabled, so tap each question with `repeat:1|click:` (tolerates a session that already answered some) rather than looping.
- Career code loads on demand: the first open after a cold start waits for its chunk.
