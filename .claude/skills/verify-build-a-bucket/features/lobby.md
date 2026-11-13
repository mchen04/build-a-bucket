# Shared multiplayer league

Two to eight people share one server-authoritative NBA league by invite code. The host picks Normal, Salary Cap or
Squad and the era. Everyone draws a different team, builds for it, and then watches one 82-game season, play-in and
playoff bracket with the same results. Checkpoints pause for everyone present; away and left players never block.

## Sub-features

- `lobby-create` creates a lobby with a 6-character code and makes the creator host.
- `lobby-join` joins by code in any letter case; unknown codes and full lobbies are refused.
- `lobby-capacity` hands out exactly 8 distinct seats under concurrent joins.
- `lobby-draw` gives every participant a unique team; `lobby-reroll` spends exactly one reroll into an unclaimed team.
- `lobby-lock` lets the host lock assignments and open building.
- `lobby-build` runs the Normal, Salary Cap or Squad builder for the assigned team.
- `lobby-preview` shows every team and build OVR; everyone readies or the host starts the season.
- `lobby-season` reveals the regular season in batches and pauses at four quarter checkpoints.
- `lobby-awards` shows final standings and awards; `lobby-playin` shows the play-in.
- `lobby-playoffs` reveals each round game by game and never shows a result ahead of the cursor.
- `lobby-recap` shows the champion, every finish and friend head-to-head; `lobby-rematch` keeps seats and code.
- `lobby-reconnect` restores the same seat, team, reroll state and build after reload.
- `lobby-leave` frees the seat before the draw and hands host over when the host leaves.

## How to get to it (user POV)

- Home, "Play with friends": type a name (`[data-testid="mp-name"]`), then `Create lobby` (`create-lobby`), or type a
  code (`mp-code`) and `Join` (`join-lobby`).

## Driving it with control.mjs

Preconditions:

- Dev launch (database reachable); one `--session` per player.

- **Create.** `ui --feature lobby --session ava --step 'fill:css:[data-testid="mp-name"]=>Ava' --step 'click:css:[data-testid="create-lobby"]' --step 'read:code=[data-testid="lobby-code"]' --step overflow --step shot:created`.
- **Join.** `ui --feature lobby --session ben --step 'fill:css:[data-testid="mp-name"]=>Ben' --step 'fill:css:[data-testid="mp-code"]=>{code}' --step 'click:css:[data-testid="join-lobby"]' --step 'see:text:Ava' --step overflow --step shot:joined`.
- **Start and draw.** Host: `--step 'click:css:[data-testid="start-season"]' --step 'click:css:[data-testid="draw-team"]' --step 'see:css:[data-testid="reroll-team"]'`. Each guest draws too. The roster shows one team per seat and no duplicates.
- **Lock and build.** Host: `--step 'click:css:[data-testid="lock-teams"]'`. Each session: `--step 'click:css:[data-testid="open-builder"]' --step spinpick:10 --step 'click:button:Submit build' --step 'see:text:Build submitted'`.
- **Preview and season.** Each session: `--step 'click:css:[data-testid="preview-ready"]'`. The last ready starts the season; `[data-testid="league-stage"]` appears and `[data-testid="awards"]`, `[data-testid="playoffs"]` and `[data-testid="recap"]` are absent.
- **Checkpoints.** At a checkpoint the panel shows `Ready` and, for the host, `Advance`. Everyone present readies, or the host advances. A retry never skips a checkpoint.
- **Recap and rematch.** `--step 'see:css:[data-testid="recap"]' --step 'see:css:[data-testid="champion-banner"]' --step shot:recap`; the host taps `rematch` and the lobby returns to the team draw with the same code and seats.
- **Capacity and API side.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --players 8 --extra 4 --seconds 10`: `distinctSeats` is 8 and `joinStatuses` shows 7 successes and 4 refusals.
- **Full scripted proof.** `npm run e2e -- e2e/lobby.spec.ts --project=mobile-chromium` drives two contexts from invite code to recap and rematch (needs port 4173 free).

## Gotchas

- Sessions share nothing but the server: a player only reconnects with the same `--session`.
- The host must lock the teams; the draw does not advance on its own, so rerolls stay available.
- On a loaded host (load average above about 10) client requests can exceed their 8 s budget and show "reconnecting"; check `uptime` before calling it a regression.
- Lobbies made against a deployed stack are not deleted by cleanup.
- Away (unseen for 60 s) and left players never block a checkpoint; the host role moves to the earliest joined present player when the host is away for 45 s or leaves.
