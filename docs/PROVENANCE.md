# Provenance of rule constants

Every numeric constant that decides an outcome lives in `src/shared/engine/rules.ts` (team tables, weights,
benchmarks, league constants) or in the engine module named below. Values were read from the original's public
source at commit `92cb2a155bb2261cd68038ac366b994ad5dbb873`, re-expressed as our own typed code. No source
code was copied, and no player, team or authored text is stored in this repo.

Line numbers refer to the prettier output in the recon bundle (`recon/pretty/<chunk>.js`).

| Constant or rule | Source | Where it lives here |
|---|---|---|
| Attribute lists per position and grade letters | `progress-BcN2v_d9.js` `Hi`/`_i`; `data-dcp-BfrsYnfU.js` `rr` | `rules.ts` `GUARD_ATTRS`, `BIG_ATTRS`, `GRADES`, `ATTR_LABELS` |
| OVR weights and formula | `progress` `hi` (~737) | `rules.ts` `OVR_WEIGHTS`, `ovr.ts` `computeOvr` |
| Guard and big archetype trees | `progress` `Xh` (~1170), `Zh` (~1378) | `archetype.ts` `guardLabel`, `bigLabel` (same branch order and thresholds 95/90/84/76/68) |
| Team strength tables (current, all-time) | `progress` `me` (~630), `pt` (~662) | `rules.ts` `CURRENT_TEAMS`, `ALLTIME_TEAMS` |
| Conferences, finals opponent pools | `progress` `Qe`, `pa`, `Hs` | `rules.ts` `EAST`, `WEST`, `CURRENT_FINALS_OPPS`, `ALLTIME_FINALS_OPPS` |
| Win probability, player boost, caps and floors | `progress` `qh` (~972) | `season.ts` `simulateSeason` |
| Season averages, FG/3P/FT, turnovers | `progress` `qh` | `season.ts` `simulateSeason` |
| PER league constants and formula | `progress` `F` (~933), `_s`, `gi` | `rules.ts` `PER_LEAGUE`, `season.ts` `uPer`, `perFor` |
| Game loop, scores, standings | `progress` `qh`, `Ws` (~759), `rt` | `season.ts` `simulateSeason`, `buildStandings`, `teamStrength` |
| Play-in rule for seeds 7 to 10 | `progress` `ci` (~778) | `season.ts` `playIn` |
| Series probability and best-of-seven | `progress` `et` (~821), `li` (~749), `Ks` (~827) | `season.ts` `seriesProb`, `playSeries`, `playPlayoffs` |
| Saved MVP benchmarks and DPOY check | `progress` `qh` (~1117 onward) | `rules.ts` `MVP_BENCHMARKS_*`, `season.ts` `simulateSeason` |
| Displayed MVP/DPOY candidate ranges and lottery | `BucketSimPage-vHhXBoFx.js` `J` (~3330-3410) | `rules.ts` `DISPLAY_MVP_*`, `DISPLAY_DPOY_*`, `season.ts` `displayAwards` |
| GOAT rank | `BucketSimPage` `Oe` (~1251) | `season.ts` `goatRank` |
| Seeded string PRNG, Fisher-Yates, weighted shuffle | `progress` `We` (~587), `Qs`, `Uh` | `rng.ts` `hashString`, `mulberry32`, `seededShuffle`, `weightedShuffle` |
| Spin seeds and respin targets | `homeLook-CgOS2Exw.js` (~893-915) | `spin.ts` `spinTarget`, `run.ts` `respinSeedFor` |
| Data file names and pinned commit | `CONTRACT.md` "Stack" | `rules.ts` `DATA_SHA`, `DATA_BASE`; `loader.ts` `FILES` |
| Headshot URL shape and generic fallback by skin luminance | `data-dcp` `kt`, `BucketApp` 1010-1014 | `loader.ts` `headshotFor`, `photoFor`; unreadable images fall back to initials |
| Build height and weight come from the `size` pick | `AppBuildTray` 836-870 (`le` = `5'11"` format) | `rules.ts` `heightLabel`, `weightLabel`; `run.ts` `heightWeightFor` |
| Letter grades and the `bap-hide-grades` preference | `data-dcp` `rr`; `homeLook` 609-616, 689 | `rules.ts` `GRADES`, `valueLabel`; `app/prefs.ts` |
| Final report wording per finish | `utils/seasonCard.js` 780-812 | `season.ts` `seasonHeadline`; the OVR and archetype come from the result, not from the build |
| Season moments: stops, phases, weights, recent list, off switch | `src/lib/seasonDirector.js` (stops, resim, sat), `src/lib/scenarios.js` (`pickScenario`, `phaseOf`, `o`, `gam`, `mix`, `ROLE`) | `season.ts` `seasonStops`, `startSeason`, `chooseMoment`, `passStop`, `finalizeDraft`; `app/momentFlow.ts`; `app/prefs.ts` (`bap_moments_off`, `bap_scn_recent`) |

## Season moments

The banks are functions of a context object, so they are not plain literals. `src/shared/data/moments.ts`
fetches `src/lib/scenarios.js` at the pinned commit, slices the `NBA_ALL` and `NBA_PLAYOFFS` array literals and
reads them with a small literal reader that never runs the file. It understands the shapes those two banks use:
`o(id, label, effect, flavor)` options, `gam(p, hit, hitLine, miss, missLine)` gambles, `mix(...)` and the
`c.R`/`c.R1` role calls, `dealFx`, object literals, and template strings whose `${...}` parts become tokens the
app fills in. Anything it cannot read is skipped and recorded, and the app plays on without it.

- Options' `attr` deltas map through the same role table (`guard`/`big`) and clamp to 1..11 like the original.
- `team` mods multiply by 3.3 when they set the win probability, as the original's `offMod`/`defMod` do.
- Gamble branches are rolled once and the winning branch's tag and line are kept.
- A `sit` effect zeroes the missed games and wins them at `clamp(strength - .05, .2, .7)`; `then` applies when the sit ends.
- Totals for the season come from the game log once a moment has been played.

**Not extracted** (listed as missing, not guessed): the `INJURY` and `PO_INJURY` cards, because their `make`
needs the injury table and a body part rolled from the build; the `when` predicates, which are read as
requirements (`alive`/`clinched`/`eliminated` plus `left >= n`) rather than evaluated; `window` and `dur`, which
are recorded on the decision but do not change later games; and the `xp` value, which no system reads yet.
Because of that a season shows two or three moments rather than the original's three or four.
`qbRespinBonus` (a suspected rewarded ad) is always 0.

## Offline modes (daily, salary cap, squad)

The constants and generators of the three rebuilt offline modes were traced from the pinned public source at
`92cb2a155bb2261cd68038ac366b994ad5dbb873` and are re-expressed in our own modules:

- `src/shared/engine/daily.ts` — the day key, the 2026-10-23 rotation, the `bap-daily-<date>` seed
  (`src/lib/progress.js` and the daily helpers in `src/components/BucketApp.jsx`).
- `src/shared/engine/salary.ts` — columns, prices, rank bands, the cap table and its three fixed dates, the
  hash RNG, the legend shuffle constant `0xBADC0FFE`, the yesterday penalty and the board generator
  (`src/lib/salaryCore.js`, `src/data/nba-salary.js`, `src/components/BucketSalaryCap.jsx`).
- `src/shared/engine/squad.ts` — caps, the strength moves (guard `.45/.15`, big `.25/.35`), the replacement
  rating 64, the seeded record/playoff simulation, the all-time league offset and the honour composite and
  thresholds (`src/lib/squadSeason.js`, `src/lib/teamSeason.js`, `src/utils/bucketSimulation.js`).
- The team-pick hash (`0x45d9f3b`) and the hash RNG (`0x45d9f3b`/`0x119de1f3`) live in
  `src/shared/engine/rng.ts` beside the mulberry32 and string-hash RNGs used elsewhere.

Expected values for the golden tests were transcribed from those algorithms; the original's code is never
executed. See `docs/MODES.md` for what matches, and where a limitation is recorded.

