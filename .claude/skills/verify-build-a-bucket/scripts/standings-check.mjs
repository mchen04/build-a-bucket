import fs from 'node:fs';
import path from 'node:path';

function normalizeRow(row) {
  return String(row).replace(/YOU/g, '').replace(/\s+/g, ' ').trim();
}

export function isValidRevision(revision) {
  return Boolean(
    revision &&
      typeof revision === 'object' &&
      typeof revision.stage === 'string' &&
      revision.stage.trim().length > 0 &&
      typeof revision.progress === 'string' &&
      revision.progress.trim().length > 0,
  );
}

export function revisionKey(revision) {
  if (!isValidRevision(revision)) return null;
  return `${revision.stage.trim()}\u0000${revision.progress.trim()}`;
}

export function revisionLabel(revision) {
  if (!isValidRevision(revision)) return 'invalid revision';
  return `${revision.stage.trim()}:${revision.progress.trim()}`;
}

export function readLeagueStandings() {
  const field = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return '';
    if (node.hidden) return '';
    if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) return '';
    return String(node.innerText ?? node.textContent ?? '').trim();
  };
  const revision = {
    stage: field('[data-testid="league-stage-name"]'),
    progress: field('[data-testid="league-stage-progress"]'),
  };
  const tables = [...document.querySelectorAll('[data-testid="standings"] .table')].map((table) =>
    [...table.querySelectorAll('.table-row:not(.head)')].map((row) => row.innerText || ''),
  );
  return { revision, tables };
}

function seatLabel(seat) {
  if (!seat || typeof seat !== 'object') return null;
  const number = Number(seat.seat);
  if (!Number.isInteger(number) || number < 1) return null;
  if (typeof seat.name !== 'string' || seat.name.trim().length === 0) return null;
  return `${number}:${seat.name.trim()}`;
}

export function distinctSeatLabels(seats) {
  const out = new Set();
  for (const entry of Array.isArray(seats) ? seats : []) {
    if (typeof entry === 'string') {
      const match = /^(\d+):(.+)$/.exec(entry.trim());
      if (match && match[2].trim()) out.add(`${Number(match[1])}:${match[2].trim()}`);
    } else {
      const label = seatLabel(entry);
      if (label) out.add(label);
    }
  }
  return out;
}

export function canonicalTables(tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  return tables.map((rows) => (Array.isArray(rows) ? rows.slice(0, 10).map(normalizeRow) : []));
}

export function compareStandings(reads, refreshedSeat) {
  const groups = new Map();
  let invalid = 0;
  for (const read of reads) {
    const key = revisionKey(read.revision);
    if (key === null) {
      invalid++;
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, { revision: { stage: read.revision.stage.trim(), progress: read.revision.progress.trim() }, reads: [] });
    }
    groups.get(key).reads.push(read);
  }
  for (const { revision, reads: group } of groups.values()) {
    const distinct = distinctSeatLabels(group.map((entry) => entry.seat));
    if (distinct.size < 2) continue;
    const refreshedLabel = seatLabel(refreshedSeat);
    if (!refreshedLabel || !distinct.has(refreshedLabel)) continue;
    const tables = group.map((entry) => canonicalTables(entry.tables));
    if (tables.some((value) => value.length === 0 || value.some((rows) => rows.length === 0))) {
      return { ok: false, reason: `empty standings at revision ${revisionLabel(revision)}` };
    }
    if (!tables.every((value) => JSON.stringify(value) === JSON.stringify(tables[0]))) {
      return { ok: false, reason: `standings differ at revision ${revisionLabel(revision)}` };
    }
    return {
      ok: true,
      revision,
      seats: [...distinct],
      standings: tables[0],
      rowsCompared: tables[0].reduce((sum, rows) => sum + rows.length, 0),
    };
  }
  if (groups.size === 0 && invalid > 0) return { ok: false, reason: 'no valid displayed revision' };
  return { ok: false, reason: 'no common standings revision' };
}

export function createLeagueEvidenceDir(evidenceRoot, stamp = new Date().toISOString().replace(/[:.]/g, '-'), suffix = Math.random().toString(36).slice(2, 8)) {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const dir = path.join(evidenceRoot, `league-${stamp}-${suffix}`);
  fs.mkdirSync(dir);
  return dir;
}

export function refreshCoverage(reloadRequested, reload) {
  if (!reloadRequested) return { ok: true, reason: null };
  if (!reload?.ran) return { ok: false, reason: 'reload did not run' };
  if (!isValidRevision(reload.revision)) return { ok: false, reason: 'reload recorded no valid displayed revision' };
  const distinct = distinctSeatLabels(reload.seats);
  if (distinct.size < 2) return { ok: false, reason: 'reload compared fewer than two distinct players' };
  const refreshedLabel = seatLabel(reload.refreshedSeat);
  if (!refreshedLabel) return { ok: false, reason: 'reload recorded no refreshed seat' };
  if (!distinct.has(refreshedLabel)) return { ok: false, reason: 'reload did not include the refreshed seat' };
  if (!reload.rowsCompared) return { ok: false, reason: 'reload compared zero rows' };
  return { ok: true, reason: null };
}

export function reloadRecord(reloadRequested, reload) {
  const coverage = refreshCoverage(reloadRequested, reload);
  return { ...reload, coverage: coverage.ok ? 'ok' : coverage.reason };
}

export function leagueFailureSummary({ error, code = null, players, mode, era, device, viewport, chaos, reloadRequested, reload, evidence, at }) {
  return {
    ok: false,
    error: String(error?.message ?? error),
    code,
    players,
    mode,
    era,
    device,
    viewport,
    chaos,
    reload: reloadRecord(reloadRequested, reload),
    evidence,
    failedAt: at,
  };
}

export function assertRefreshCoverage(reloadRequested, reload) {
  const coverage = refreshCoverage(reloadRequested, reload);
  if (!coverage.ok) throw new Error(`refresh coverage missing: ${coverage.reason}`);
}
