import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateLeague } from '../src/shared/engine/league.js';
import { DATA_BASE } from '../src/shared/engine/rules.js';

const catalog = JSON.parse(readFileSync(path.join(process.cwd(), '.claude/skills/verify-build-a-bucket/fixtures/league-fixtures.json'), 'utf8'));
const dataSha = DATA_BASE.split('@')[1] ?? '';

function humansFor(entry: { participants: { id: string; seat: number; name: string; team: string; power: { position: string; ovr: number; values: Record<string, number>; squadStrength?: { off: number; def: number }; squadPlayers?: { slot: string; position: string; values: Record<string, number> }[] } }[] }) {
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

describe('fixture catalog', () => {
  it('pins the app catalog', () => {
    expect(catalog.dataSha).toBe(dataSha);
  });

  it('has unique ids and codes', () => {
    expect(new Set(catalog.entries.map((entry: { id: string }) => entry.id)).size).toBe(catalog.entries.length);
    expect(new Set(catalog.entries.map((entry: { code: string }) => entry.code)).size).toBe(catalog.entries.length);
  });

  it('recomputes every class and qualifying seats', () => {
    for (const entry of catalog.entries) {
      const result = simulateLeague({ seed: entry.secret, era: entry.era, mode: entry.mode, humans: humansFor(entry) as any });
      const qualifyingSeats = result.humans.filter((human) => human.madePlayoffs).map((human) => human.seat);
      expect(qualifyingSeats).toEqual(entry.qualifyingSeats);
      expect(qualifyingSeats.length > 0 ? 'qualifying' : 'all-eliminated').toBe(entry.expectedClass);
    }
  });
});
