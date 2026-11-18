import fs from 'node:fs';
import path from 'node:path';

function normalizeRow(row) {
  return String(row).replace(/YOU/g, '').replace(/\s+/g, ' ').trim();
}

export function canonicalTables(tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  return tables.map((rows) => (Array.isArray(rows) ? rows.slice(0, 10).map(normalizeRow) : []));
}

export function compareStandings(reads, refreshedSeat) {
  const groups = new Map();
  for (const read of reads) {
    if (!groups.has(read.revision)) groups.set(read.revision, []);
    groups.get(read.revision).push(read);
  }
  for (const [revision, group] of groups) {
    if (group.length < 2) continue;
    if (!group.some((entry) => entry.seat.seat === refreshedSeat.seat && entry.seat.name === refreshedSeat.name)) continue;
    const tables = group.map((entry) => canonicalTables(entry.tables));
    if (tables.some((value) => value.length === 0 || value.some((rows) => rows.length === 0))) {
      return { ok: false, reason: `empty standings at revision ${revision}` };
    }
    if (!tables.every((value) => JSON.stringify(value) === JSON.stringify(tables[0]))) {
      return { ok: false, reason: `standings differ at revision ${revision}` };
    }
    return {
      ok: true,
      revision,
      seats: group.map((entry) => `${entry.seat.seat}:${entry.seat.name}`),
      standings: tables[0],
      rowsCompared: tables[0].reduce((sum, rows) => sum + rows.length, 0),
    };
  }
  return { ok: false, reason: 'no common standings revision' };
}

export function createLeagueEvidenceDir(evidenceRoot, stamp = new Date().toISOString().replace(/[:.]/g, '-'), suffix = Math.random().toString(36).slice(2, 8)) {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const dir = path.join(evidenceRoot, `league-${stamp}-${suffix}`);
  fs.mkdirSync(dir);
  return dir;
}

export function assertRefreshCoverage(reloadRequested, reload) {
  if (!reloadRequested) return;
  if (!reload?.ran || !reload.revision || !Array.isArray(reload.seats) || reload.seats.length < 2 || !reload.rowsCompared) {
    throw new Error('refresh coverage missing: --reload did not compare a non-empty shared revision including the refreshed seat');
  }
}
