import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../../../src/shared/data/loader.js';
import { autoBuild, buildSeedFor, powerFromBuild, validateBuild } from '../../../../src/server/league.js';
import { LEAGUE_TEAMS, simulateLeague } from '../../../../src/shared/engine/league.js';
import { DATA_BASE } from '../../../../src/shared/engine/rules.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'league-fixtures.json');
const DATA_SHA = DATA_BASE.split('@')[1] ?? '';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const specs = [
  ...Array.from({ length: 10 }, (_, index) => ({ id: `squad-4p-q${index + 1}`, mode: 'squad', era: 'current', players: 4, expectedClass: 'qualifying' })),
  { id: 'normal-2p-q1', mode: 'normal', era: 'current', players: 2, expectedClass: 'qualifying' },
  { id: 'normal-2p-q2', mode: 'normal', era: 'current', players: 2, expectedClass: 'qualifying' },
  { id: 'squad-4p-elim', mode: 'squad', era: 'current', players: 4, expectedClass: 'all-eliminated' },
];

function codeFor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  let code = '';
  for (let index = 0; index < 6; index++) {
    code += ALPHABET[hash % ALPHABET.length];
    hash = Math.floor(hash / ALPHABET.length);
  }
  return code;
}

function humansFor(entry) {
  return entry.participants.map((participant) => ({
    participantId: participant.id,
    seat: participant.seat,
    name: participant.name,
    team: participant.team,
    position: participant.power.position,
    ovr: participant.power.ovr,
    values: participant.power.values,
    squadStrength: participant.power.squadStrength,
    squadPlayers: participant.power.squadPlayers,
  }));
}

function classOf(entry) {
  const result = simulateLeague({ seed: entry.secret, era: entry.era, mode: entry.mode, humans: humansFor(entry) });
  const qualifyingSeats = result.humans.filter((human) => human.madePlayoffs).map((human) => human.seat);
  return { qualifyingSeats, expectedClass: qualifyingSeats.length > 0 ? 'qualifying' : 'all-eliminated' };
}

async function findFixture(spec, catalog) {
  for (let attempt = 0; attempt < 4000; attempt++) {
    const secret = `fixture-${spec.id}-${attempt}`;
    const participants = [];
    let valid = true;
    for (let index = 0; index < spec.players; index++) {
      const seat = index + 1;
      const id = `p${seat}-${attempt}`;
      const team = LEAGUE_TEAMS[(seat - 1) % LEAGUE_TEAMS.length];
      const buildSeed = buildSeedFor(secret, id);
      const check = autoBuild({ mode: spec.mode, era: spec.era }, catalog, team, buildSeed, secret);
      if (!check.ok || !check.build || !check.power || !check.summary) {
        valid = false;
        break;
      }
      participants.push({ id, seat, name: `P${seat}`, team, build: check.build, power: check.power, summary: check.summary });
    }
    if (!valid) continue;
    const entry = { id: spec.id, mode: spec.mode, era: spec.era, players: spec.players, code: codeFor(spec.id), secret, participants, dataSha: DATA_SHA };
    const observed = classOf(entry);
    if (observed.expectedClass !== spec.expectedClass) continue;
    return { ...entry, expectedClass: observed.expectedClass, qualifyingSeats: observed.qualifyingSeats };
  }
  throw new Error(`no fixture found for ${spec.id}`);
}

function check(catalogJson, catalog) {
  if (catalogJson.dataSha !== DATA_SHA) throw new Error(`catalog pin ${catalogJson.dataSha} != ${DATA_SHA}`);
  const ids = new Set();
  const codes = new Set();
  for (const entry of catalogJson.entries) {
    if (ids.has(entry.id)) throw new Error(`duplicate id ${entry.id}`);
    if (codes.has(entry.code)) throw new Error(`duplicate code ${entry.code}`);
    ids.add(entry.id);
    codes.add(entry.code);
    for (const participant of entry.participants) {
      const settings = { mode: entry.mode, era: entry.era };
      const buildSeed = buildSeedFor(entry.secret, participant.id);
      const valid = validateBuild(participant.build, settings, catalog, participant.team, entry.secret, { buildSeed });
      if (!valid.ok) throw new Error(`${entry.id} ${participant.id} invalid build: ${valid.error}`);
      const power = powerFromBuild(participant.build, settings, catalog, participant.team);
      if (JSON.stringify(power) !== JSON.stringify(participant.power)) throw new Error(`${entry.id} ${participant.id} power mismatch`);
    }
    const observed = classOf(entry);
    if (observed.expectedClass !== entry.expectedClass) throw new Error(`${entry.id} class ${observed.expectedClass} != ${entry.expectedClass}`);
    if (JSON.stringify(observed.qualifyingSeats) !== JSON.stringify(entry.qualifyingSeats)) throw new Error(`${entry.id} qualifying seats mismatch`);
  }
  console.log(`fixture catalog check passed: ${catalogJson.entries.length} entries at ${DATA_SHA}`);
}

const catalog = await loadCatalog();
if (process.argv.includes('--check')) {
  check(JSON.parse(fs.readFileSync(OUT, 'utf8')), catalog);
} else {
  const entries = [];
  for (const spec of specs) entries.push(await findFixture(spec, catalog));
  const catalogJson = { dataSha: DATA_SHA, entries };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(catalogJson, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${entries.length} entries at ${DATA_SHA}`);
}
