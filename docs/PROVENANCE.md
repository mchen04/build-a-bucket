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
| Headshot URL shape and fallback | `data-dcp` `kt` | `loader.ts` `headshotFor`, `components.tsx` `Avatar` initials fallback |

## Not reproduced in this turn

- Season moment banks (`seasonDirector-CDEsiyGm.js`, ~3581-4222). The banks load at runtime from the pinned
  commit; until they are wired, the season screen shows a visible note. No moment text is stored here.
- `qbRespinBonus` (suspected rewarded ad). Always 0, per `CONTRACT.md`.
- Multiplayer, Daily, Salary Cap, Squad, Career and the online modes. Later phases.
