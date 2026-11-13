# Multiplayer lobby

Two to eight people share a lobby by invite code. The host starts; everyone builds at once and sees the others' progress live; seasons run on the server; qualifiers wait at a barrier and enter the playoffs together, with rounds revealed on a shared clock; a final standings table ranks everyone.

## Sub-features

- `lobby-create` creates a lobby with a 6-character code and makes the creator host.
- `lobby-join` joins by code in any letter case; unknown codes and full lobbies are refused.
- `lobby-capacity` hands out exactly 8 distinct seats under concurrent joins.
- `lobby-activity` shows each peer's picks n/10 and a one-line ticker of the newest event.
- `lobby-barrier` holds qualifiers until every present player is done; eliminated players never enter.
- `lobby-playoffs` reveals rounds together and never shows a result ahead of the current round.
- `lobby-reconnect` restores a seat after reload (same browser storage).
- `lobby-leave` frees the seat before start and hands host over when the host leaves.

## How to get to it (user POV)

- Home, "Play with friends": type a name (`[data-testid="mp-name"]`), then `Create lobby` (`create-lobby`), or type a code (`mp-code`) and `Join` (`join-lobby`).

## Driving it with control.mjs

Preconditions:

- Dev launch (database reachable); one `--session` per player.

- **Create.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature lobby --session ava --step 'fill:css:[data-testid="mp-name"]=>Ava' --step 'click:css:[data-testid="create-lobby"]' --step 'read:code=[data-testid="lobby-code"]' --step overflow --step shot:created`. The code is stored as `{code}` and recorded for cleanup.
- **Join.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature lobby --session ben --step 'fill:css:[data-testid="mp-name"]=>Ben' --step 'fill:css:[data-testid="mp-code"]=>{code}' --step 'click:css:[data-testid="join-lobby"]' --step 'see:text:Ava' --step overflow --step shot:joined`. Repeat with more sessions up to 8; a ninth gets a "full" error.
- **Start and build.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs ui --feature lobby --session ava --step 'see:text:Ben' --step 'click:css:[data-testid="start-season"]' --step 'click:css:[data-testid="open-builder"]' --step spinpick:3`, then in Ben's session `--step 'see:css:[data-testid="activity-ticker"]' --step shot:peer-progress`. Ben sees Ava at 3/10 and her newest pick in the ticker within about 2.5 s.
- **Season and barrier.** Each session: `--step 'click:css:[data-testid="open-builder"]' --step spinpick:10 --step 'click:button:Spin for Team' --step 'click:css:.spin-big' --step 'click:button:Submit build' --step 'see:css:[data-testid="my-result"]'`. A qualifier shows `[data-testid="barrier-state"]` with "n/m ready"; the count is identical on every screen.
- **Playoffs and standings.** After the last submit: `--step 'see:text:Playoffs' --step 'see:css:[data-testid="next-reveal"]' --step shot:round` in two sessions within one reveal interval show the same round; then `--step 'see:css:[data-testid="standings"]' --step shot:standings`.
- **Capacity and API side.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --players 8 --extra 4 --seconds 10`: `distinctSeats` is 8 and `joinStatuses` shows 7 successes and 4 refusals.
- **Full scripted proof.** `npm run e2e -- e2e/lobby.spec.ts --project=mobile-chromium` drives 8 contexts end to end (needs port 4173 free).

## Gotchas

- Sessions share nothing but the server: a player only reconnects with the same `--session`.
- Moments are off in lobbies by rule; seasons run straight through.
- On a loaded host (load average above about 10) client requests can exceed their 8 s budget and show "reconnecting"; check `uptime` before calling it a regression.
- Lobbies made against a deployed stack are not deleted by cleanup.
