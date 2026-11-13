# Career

The original's Career mode, rebuilt on the shared engine: build a player, the combine and the draft, seasons
played ten games at a time, injuries, form swings, the playoffs, awards, the offseason (development, aging,
contracts, trades), retirement, the Hall of Fame vote and a finished-careers history. Career is its own chunk:
its JavaScript loads only when the player opens it (`src/app/modes/CareerMode.tsx`), so the first load of the
app does not grow.

## Flow

1. **Slots** (`CareerHome`) — five save slots, plus the last 20 finished careers. Empty slots start a new
   player (position, first and last name, mini-games mode).
2. **Build** — the normal ten-pick builder (`Builder`), exactly the classic spins; the build becomes the
   career's starting attributes.
3. **The combine** (`CareerDraft`) — three drills (guard: 3/4-court sprint, lane agility, spot-up shooting;
   big: max vertical, bench press, spot-up shooting). Each drill turns its trait into the combine's own scale
   (the original's norms: a B-speed guard runs about a 3.25 sprint, a B big presses about 10 reps) and moves
   the draft window.
4. **Interviews** — four teams from around the projected slot, one question each, three answers (stock -2 to
   +2 with everyone, and most with the team that asked).
5. **Draft day** — the ticker of the six picks before his, then the team and the pick: the roulette is
   weighted by `need² + 1 + 8·interest` inside the stock window. The rookie deal is the original's: four years
   with a team option for picks 1-30, two years after; $12.5M / $9.5M / $6.5M / $5M / $2.8M / $1.9M a year by
   pick.
6. **Seasons** — ten games a press. The team's win probability comes from its rating (the original's career
   path: the roster's off/def on the 1-10 scale, plus the OVR boost). Injuries, form swings ("he is quietly
   better than his ratings", one season in eight each way) and hot/cold streaks are the original's seeded
   rolls. A season also deals a handful of moments (mini-games), the playoffs (play-in for seeds 7-10, the
   best-of-seven series odds of `bucketRoundOdds`), the awards (MVP on the original's vote, 65-game rule; the
   40-game All-Star rule) and the goals set for the role.
7. **Offseason** — the recap and the team's moves, training camp, then development points (two a year while
   young, one through the prime), training windows by age, the aging/fade model (`careerAging`), body work,
   the contract market (stay / contender / payer offers, and talks where the player can push money, years, a
   no-trade clause or a starter guarantee), trades and shoe deals.
8. **Retirement and legacy** — forced at 38 (40 for an elite, durable body), after twenty seasons, or when
   nobody calls; voluntary from 29 or eight seasons. Retirement computes the legacy score (`LEGACY_W`, honors
   past the eighth counted half, awards worth more each repeat, career production and the small extras) and the
   Hall of Fame vote (`pct = clamp(round(20 + (score-100)·0.55 + (u-0.5)·8), 2, 99)`, inducted at 80).

## Seeds

Every roll uses the original's string PRNG (`src/shared/engine/rng.ts` `seededRng`, the same hash and mulberry
step as `seeded` in the original) keyed `${seed}-<purpose>-<year>`:

| Roll | Key |
|---|---|
| Draft order | `draft-<seed>` |
| The player's pick | `draft2-<seed>` |
| Interviews | `int-<seed>` |
| Combine (durability) | `dur-<seed>`, `career-<seed>` |
| Per-game injury | `<seed>-inj-<year>-<game>` |
| Injury outcome | `<seed>-injres-<year>-<game>` |
| Season form and streak | `<seed>-swing-<year>` |
| Playoff bracket | `<seed>-po-<year>` |
| A playoff round | `<seed>-por-<year>-<round>`, `<seed>-<year>-<round>-series`, `-series-rest` |
| MVP vote | `<seed>-mvp-<year>` |
| Finals MVP | `<seed>-fmvp-<year>` |
| Free agency | `<seed>-fa-<year>`, `<seed>-fa-pick-<year>`, `<seed>-ask-<year>-<n>-<kind>` |
| Offseason events | `<seed>-ev-<year>`, `<seed>-off-<year>` |
| Aging and work | `<seed>-age-<year>`, `<seed>-agegene[-<trait>]`, `<seed>-wear-<trait>`, `<seed>-fade-<year>-<trait>` |
| Shoe deals, camp | `<seed>-shoe-<year>`, `<seed>-campdev-<year>` |
| Hall of Fame | `<seed>-hof` |

The same seed and the same decisions therefore produce the same draft, contracts, injuries and swings as the
original; the golden tests (`tests/career.test.ts`) pin the values for the draft window, the draft order, the
team pick, the rookie deal, the injury rolls, the swing rolls and the playoff series maths. Base season games
use unseeded randomness in the original; ours are seeded from the career seed and match the original's
distribution (82 games, the same win-probability curve and score shape), which is why they are not pinned.

## Mini-games

- **Simulated** (the original's "off") is complete: every moment is played out on the odds
  (`lerp(.45, .92, clamp((rating-1)/10))`), the combine drills score off the trait, the playoffs resolve on the
  round's own series odds.
- **Simple** is built light: one timing bar (the marker crosses a window whose width scales with the moment's
  traits, `8 + 1.8·v` per cent), returning a 0-1 score. The hit rules follow the original (a clean rep at 0.75,
  a playoff round at 0.5). The original has a bespoke DOM game per moment; ours shares one, so the *feel*
  differs while the inputs, the trait scaling and the thresholds do not.
- **Advanced** (the original's 3D canvas games, a 1.15 MB three.js chunk) is not rebuilt and is shown as
  unavailable on the new-career form.

## Storage

- `bab:career:v1` — `{ v: 1, slots: [career | null × 5] }`, validated with valibot at the boundary. A slot
  that does not parse is dropped (the other slots still load) and the player sees an empty slot rather than a
  crash. The run is written on every action, so a reload resumes mid-combine, mid-season, mid-offseason or on
  the retired screen.
- `bab:career:history:v1` — the last 20 finished careers (`name`, seasons, rings, awards, OVR, legacy, HOF,
  when).
- Real player ages for roster turnover load at runtime from the original's `src/data/player-ages.js` at the
  pinned commit; if that fetch fails the session falls back to deterministic generated ages (stated on the
  career screen).

## Known limits

- The Pro-only comeback ("unretire", up to three more seasons) is shown as unavailable, never faked.
- League news, career records (`seasonFacts.js`), legacy comps and the all-time rank against the original's
  greats are not rebuilt; the legacy card shows the score, the tier and the Hall vote instead.
- The career's moments are dealt on our own five-game schedule (the original's director places its own stops);
  the rolls that decide outcomes are the seeded ones above.
- Advanced mini-games (3D) are not rebuilt; simple mode is one shared timing bar (see above).
- The original's cloud sync (`careers` table) is not rebuilt: saves are local to the device.
