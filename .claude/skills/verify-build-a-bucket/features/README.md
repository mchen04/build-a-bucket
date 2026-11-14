# Build a Bucket verification map

This directory is the maintained source for verifying what a phone user can do in the Build a Bucket rebuild. Read this index, then use the matching feature file as the recipe.

## Baseline preconditions

- `control.mjs launch` succeeded and `control.mjs doctor` reports `ok: true` for this run.
- jsDelivr is reachable (the player catalog and Moments load from the original's public repo at a pinned commit).
- Lobby features need the dev database (`.env.local`); other features need no server state.
- Every journey starts from a fresh `--session` (empty localStorage) unless it says otherwise.
- Never drive an instance this run did not launch, and never the user's own browser.

## Driving conventions

- Prefer accessible names, then `data-testid` handles; the CSS handles `.spin-big`, `.chip`, `.slot.filled` and `.bottom .btn` are the stable builder controls.
- Run `overflow` on every core screen: the product promise is no vertical scroll at 390x844.
- Cover both engines for UI changes: `--device iphone` (WebKit) and `--device pixel` (Chromium).
- Seeded modes (Daily, Salary Cap, Squad) depend on the New York date; read the date shown on screen rather than computing it.

## Proof and skip reporting

- Capture the action and the resulting state (`shot:` writes a screenshot and an aria snapshot) and the side effect (`storage:` for local saves; a second session's view or `lobby-load` JSON for server state).
- Record the feature id and the entry point used; `ui` writes both to `evidence/journal.jsonl`.
- An unreachable path is reported with the failing step and the unmet precondition, not verified through another path.

## Features

- [Single-player Play](./play.md): build ten traits, team spin, season with Moments, playoffs, final report, resume after reload.
- [Multiplayer lobby](./lobby.md): create, join by invite link, unique team draw and reroll, Normal/Salary/Squad builds, shared 82-game season, checkpoints, play-in, playoffs, recap, rematch, reconnect. `control.mjs league` drives 2 to 8 real sessions through the whole path.
- [Daily Challenge](./daily.md): shared date-seeded spins, resume, one run per day.
- [Salary Cap](./salary.md): daily budget grid with lock, infinite run.
- [Squad Builder](./squad.md): five builds, one shared season.
- [Whole-stack performance](./perf.md): cold load versus the original, lobby API under a full lobby.
- [Parity with the original](./parity.md): the original's code beside ours on the same seeds, field by field, plus the offline fixtures.

There is no Career mode in this rebuild. A feature that is not in this list has no recipe and is not proven.

## Production checks

After a deploy, compare the deployed asset hash with the local production build, run `npm run db:migrate` against the
deployed database and confirm the eight tables, then smoke the deployed stack with `cold-load --url`,
`lobby-load --base` and `league --base`. `SKILL.md` has the exact commands and what each one proves.
