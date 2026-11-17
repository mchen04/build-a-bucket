# Shared multiplayer league

Two to eight people share one server-authoritative NBA league by invite code. The host picks Normal, Salary Cap or
Squad and the era. Everyone builds first, then draws a different team, and then watches one 82-game season, play-in and
playoff bracket with the same results. Checkpoints pause for everyone present; away and left players never block.

## Sub-features

- `lobby-create` creates a lobby with a 6-character code and makes the creator host.
- `lobby-join` joins by code in any letter case; unknown codes and full lobbies are refused.
- `lobby-capacity` hands out exactly 8 distinct seats under concurrent joins.
- `lobby-build` runs the Normal, Salary Cap or Squad builder before any team is assigned.
- `lobby-draw` opens once every build is in and gives every participant a unique team; `lobby-reroll` spends exactly
  one reroll into an unclaimed team.
- `lobby-lock` lets the host lock assignments and open the preview.
- `lobby-preview` shows every team and build OVR; everyone readies or the host starts the season.
- `lobby-season` reveals the whole regular season in one run, then goes straight to the awards with no stop.
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
- **Recap and rematch.** `--step 'see:css:[data-testid="recap"]' --step 'see:css:[data-testid="champion-banner"]' --step shot:recap`; the host taps `rematch` and the lobby returns to the builds with the same code and seats.
- **Capacity and API side.** `node .claude/skills/verify-build-a-bucket/scripts/control.mjs lobby-load --players 8 --extra 4 --seconds 10`: `distinctSeats` is 8 and `joinStatuses` shows 7 successes and 4 refusals.
- **Full scripted proof.** `npm run e2e -- e2e/lobby.spec.ts --project=mobile-chromium` drives two contexts from invite code to recap and rematch (needs port 4173 free).

## Full league through the phone UI

`node .claude/skills/verify-build-a-bucket/scripts/control.mjs league --players 2 --mode normal` is the end-to-end
proof for a shared league. It opens one real browser context per seat (2 to 8), creates the lobby, reads the displayed
invite link, has every other seat open that link and join by name, builds in `--mode`
(`normal` ten spins, `salary` one card per column plus the Scout power, `squad` five complete builds), draws and
rerolls, previews, and
then at every checkpoint:

- reads `standings` from every active seat and fails unless the top ten of each conference agree;
- reads `my-team` and fails unless that seat's record and seed match its own standings row;
- fails if a seed appears during the season, or awards, play-in, playoffs or the champion appear before their stage;
- writes one screenshot and aria snapshot per active seat, then has every seat Ready and the host Advance.

It ends at the recap, compares the champion text across seats, then does Play Again: every retained seat readies, the
host opens the builds, and the second game's `open-builder` must appear. `evidence/league/summary.json` holds the code,
mode, era, each checkpoint's visible standings and each seat's record/seed, the champion, Play Again and any page or
console errors.

Chaos options, applied at the first checkpoint:

- `--reload 2` reloads seat 2 mid-season, waits for the lobby to come back, and re-compares the standings.
- `--away 2` closes seat 2's browser context; the host must still advance and the remaining seats must agree.
- `--host-leave` taps Leave lobby on the host; another seat must receive Advance and carry the league.

The season reveal is real time. The regular season takes about 35 seconds: rounds with a human game reveal at 0.4 s,
the rest 50 times faster. Playoff series between computer teams also run 50 times faster. The command has no internal setters or database jumps.

## Gotchas

- Sessions share nothing but the server: a player only reconnects with the same `--session`.
- The host must lock the teams; the draw does not advance on its own, so rerolls stay available.
- The draw auto-locks as soon as every active seat has a team. Reroll before the last seat draws, or the phase moves
  to building and the reroll button is gone.
- The invite link is displayed lowercase and the code inside it is uppercase; both the Copy button and the displayed
  text work. Typing the link by hand with an uppercase `/J/` would miss the invite route.
- On a loaded host (load average above about 10) client requests can exceed their 8 s budget and show "reconnecting"; check `uptime` before calling it a regression.
- Lobbies made against a deployed stack are not deleted by cleanup.
- Away (unseen for 60 s) and left players never block a checkpoint; the host role moves to the earliest joined present player when the host is away for 45 s or leaves.
