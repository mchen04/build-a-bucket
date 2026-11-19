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

function seatNumber(seat) {
  if (!seat || typeof seat !== 'object') return null;
  const number = Number(seat.seat);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function seatName(seat) {
  return seat && typeof seat.name === 'string' && seat.name.trim().length > 0 ? seat.name.trim() : null;
}

export function seatIdentities(seats) {
  const names = new Map();
  for (const entry of Array.isArray(seats) ? seats : []) {
    let number = null;
    let name = null;
    if (typeof entry === 'string') {
      const match = /^(\d+):(.+)$/.exec(entry.trim());
      if (match) {
        number = Number(match[1]);
        name = match[2].trim();
      }
    } else {
      number = seatNumber(entry);
      name = seatName(entry);
    }
    if (!Number.isInteger(number) || number < 1 || !name) continue;
    if (!names.has(number)) names.set(number, new Set());
    names.get(number).add(name);
  }
  return names;
}

export function distinctSeatLabels(seats) {
  return new Set([...seatIdentities(seats)].map(([number, names]) => `${number}:${[...names][0]}`));
}

export function canonicalTables(tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  return tables.map((rows) => (Array.isArray(rows) ? rows.slice(0, 10).map(normalizeRow) : []));
}

function countRows(tables) {
  return Array.isArray(tables) ? tables.reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0) : 0;
}

export function allEliminated({ out, activity }) {
  return (
    Array.isArray(out) &&
    out.length > 0 &&
    out.every(Boolean) &&
    Array.isArray(activity) &&
    activity.length > 0 &&
    activity.every((text) => String(text).includes('The playoffs started automatically'))
  );
}

const FINISHES = ['Champion', 'Finals loss', 'Conference finals', 'Semis', 'First round', 'Play-in exit', 'Missed playoffs'];
const OUT_AT_ENTRY = new Set(['Play-in exit', 'Missed playoffs']);
const AUTO_START = 'The playoffs started automatically';
const HELD_START = ['The playoffs started automatically after waiting for', 'Everyone was ready, so the playoffs started', ' started the playoffs'];

function section(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0 || text.indexOf(start, from + 1) >= 0) return null;
  const to = text.indexOf(end, from + start.length);
  return to < 0 ? null : text.slice(from + start.length, to);
}

export function parseRecapCapture(aria) {
  if (typeof aria !== 'string' || aria.length === 0) return null;
  const table = section(aria, 'SEAT PLAYER STATUS ', ' Your team');
  const final = section(aria, 'Final recap ', ' Head to head');
  const activity = section(aria, 'League activity ', ' Final recap');
  const headings = aria.match(/heading "[^"]+ are champions"/g);
  if (table === null || final === null || activity === null || !headings || headings.length !== 1) return null;
  const finish = FINISHES.join('|');
  const rows = [...table.matchAll(new RegExp(`(\\d+) (.+?)((?: (?:YOU|HOST))*) (${finish}) · (\\d+-\\d+)`, 'g'))];
  if (rows.length === 0 || rows.map((m) => m[0]).join(' ') !== table) return null;
  const finals = [...final.matchAll(new RegExp(`(\\S.*?) (\\d+-\\d+) ([A-Z]{2,4}) (${finish})`, 'g'))];
  if (finals.length === 0 || finals.map((m) => m[0]).join(' ') !== final) return null;
  return {
    seats: rows.map((m) => ({ seat: Number(m[1]), name: m[2], you: m[3].includes('YOU'), finish: m[4], record: m[5] })),
    recap: finals.map((m) => ({ name: m[1], record: m[2], team: m[3], finish: m[4] })),
    champion: headings[0],
    activity,
  };
}

export function recapElimination({ players, captures, playoffSample = null, gateSeen = false }) {
  const fail = (reason) => ({ allEliminated: false, reason, record: null });
  if (!Number.isInteger(players) || players < 1) return fail('players is invalid');
  if (gateSeen) return fail('a held playoff gate was seen');
  if (!Array.isArray(captures) || captures.length !== players) return fail('recap captures do not cover every planned seat');
  const bySeat = new Map();
  for (const capture of captures) {
    if (!Number.isInteger(capture?.seat) || capture.seat < 1 || capture.seat > players || bySeat.has(capture.seat)) return fail('recap captures have a missing, duplicate or unknown seat');
    const parsed = parseRecapCapture(capture.aria);
    if (!parsed) return fail(`seat ${capture.seat} recap capture is malformed`);
    bySeat.set(capture.seat, parsed);
  }
  const shared = (parsed) => JSON.stringify({ seats: parsed.seats.map(({ seat, name, finish, record }) => ({ seat, name, finish, record })), recap: parsed.recap, champion: parsed.champion });
  const first = bySeat.get(1);
  const expected = JSON.stringify(Array.from({ length: players }, (_, index) => index + 1));
  for (const [seat, parsed] of bySeat) {
    if (JSON.stringify(parsed.seats.map((row) => row.seat)) !== expected) return fail(`seat ${seat} recap does not list every seat once`);
    const own = parsed.seats.filter((row) => row.you);
    if (own.length !== 1 || own[0].seat !== seat) return fail(`seat ${seat} recap is not that seat's own view`);
    if (shared(parsed) !== shared(first)) return fail(`seat ${seat} recap disagrees with seat 1`);
    if (!parsed.activity.includes(AUTO_START) || HELD_START.some((text) => parsed.activity.includes(text))) return fail(`seat ${seat} recap lacks the plain automatic playoff start`);
  }
  const names = first.seats.map((row) => row.name);
  if (new Set(names).size !== players || first.recap.length !== players) return fail('final recap does not match the seats');
  for (const row of first.seats) {
    const final = first.recap.find((entry) => entry.name === row.name);
    if (!final || final.finish !== row.finish || final.record !== row.record) return fail(`seat ${row.seat} status and final recap disagree`);
    if (!OUT_AT_ENTRY.has(row.finish)) return fail(`seat ${row.seat} finished '${row.finish}', a playoff finish`);
  }
  if (playoffSample !== null) {
    const allTrue = (values) => Array.isArray(values) && values.length === players && values.every((value) => value === true);
    if (!allTrue(playoffSample?.out) || !allTrue(playoffSample?.autoStart)) return fail('the live playoff sample contradicts all-eliminated');
  }
  return { allEliminated: true, reason: null, record: { source: 'recap', champion: first.champion, seats: first.seats.map(({ seat, name, finish, record }) => ({ seat, name, finish, record })), playoffSample } };
}

export function shouldAwaitStandings({ navigation, session }) {
  return navigation?.observed === true && session?.present === true;
}

export async function awaitReloadProof({ readAll, isRecap, refreshedSeat, wait, attempts = 40, gate = true, navigation = null, session = null }) {
  if (!gate) return { classification: 'no-held-boundary', reason: 'no held playoff gate', revision: null, seats: [], rowsCompared: 0, standings: null, attempts: [] };
  if (navigation && navigation.observed !== true) {
    return { classification: 'invalid-display', reason: navigation.reason ?? 'reload navigation not observed', revision: null, seats: [], rowsCompared: 0, standings: null, attempts: [] };
  }
  if (session && session.present !== true) {
    return { classification: 'invalid-display', reason: 'session not persisted after reload', revision: null, seats: [], rowsCompared: 0, standings: null, attempts: [] };
  }
  const start = Date.now();
  const samples = [];
  let refreshedInvalid = false;
  let recapBeforeProof = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reads = await readAll();
    const recap = await isRecap();
    const refreshed = reads.find((entry) => entry.seat.seat === refreshedSeat.seat && entry.seat.name === refreshedSeat.name);
    samples.push({
      attempt,
      ms: Date.now() - start,
      recap,
      seats: reads.map((entry) => ({ seat: entry.seat.seat, name: entry.seat.name, revision: revisionLabel(entry.revision), rows: countRows(entry.tables) })),
    });
    if (!isValidRevision(refreshed?.revision)) {
      refreshedInvalid = true;
      if (recap) {
        recapBeforeProof = true;
        break;
      }
      await wait();
      continue;
    }
    refreshedInvalid = false;
    const result = compareStandings(reads, refreshedSeat);
    if (result.ok) return { classification: 'stable-match', revision: result.revision, seats: result.seats, rowsCompared: result.rowsCompared, standings: result.standings, attempts: samples };
    if (result.reason.startsWith('standings differ')) return { classification: 'unequal', reason: result.reason, revision: null, seats: [], rowsCompared: 0, standings: null, attempts: samples };
    if (result.reason.startsWith('empty standings') || result.reason.startsWith('blank standings') || result.reason.startsWith('conflicting names')) {
      return { classification: 'invalid-display', reason: result.reason, revision: null, seats: [], rowsCompared: 0, standings: null, attempts: samples };
    }
    await wait();
  }
  if (recapBeforeProof) return { classification: 'recap-before-proof', reason: 'refreshed seat reached recap before a valid revision', revision: null, seats: [], rowsCompared: 0, standings: null, attempts: samples };
  if (refreshedInvalid) return { classification: 'invalid-display', reason: 'refreshed seat has no valid displayed revision', revision: null, seats: [], rowsCompared: 0, standings: null, attempts: samples };
  return { classification: 'no-common-revision', reason: 'no common standings revision', revision: null, seats: [], rowsCompared: 0, standings: null, attempts: samples };
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
    const identities = seatIdentities(group.map((entry) => entry.seat));
    const conflict = [...identities].find(([, names]) => names.size > 1);
    if (conflict) return { ok: false, reason: `conflicting names for seat ${conflict[0]}` };
    if (identities.size < 2) continue;
    const refreshedNumber = seatNumber(refreshedSeat);
    if (!refreshedNumber || !identities.has(refreshedNumber)) continue;
    const tables = group.map((entry) => canonicalTables(entry.tables));
    if (tables.some((value) => value.length === 0 || value.some((rows) => rows.length === 0))) {
      return { ok: false, reason: `empty standings at revision ${revisionLabel(revision)}` };
    }
    if (tables.some((value) => value.some((rows) => rows.some((row) => row === '')))) {
      return { ok: false, reason: `blank standings row at revision ${revisionLabel(revision)}` };
    }
    if (!tables.every((value) => JSON.stringify(value) === JSON.stringify(tables[0]))) {
      return { ok: false, reason: `standings differ at revision ${revisionLabel(revision)}` };
    }
    const rowsCompared = tables[0].reduce((sum, rows) => sum + rows.length, 0);
    if (!Number.isInteger(rowsCompared) || rowsCompared <= 0) {
      return { ok: false, reason: `no rows compared at revision ${revisionLabel(revision)}` };
    }
    return {
      ok: true,
      revision,
      seats: [...identities].map(([number, names]) => `${number}:${[...names][0]}`),
      standings: tables[0],
      rowsCompared,
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

export function newReloadState() {
  return { ran: false, revision: null, seats: [], rowsCompared: 0, refreshedSeat: null, allEliminated: false, allEliminatedObserved: false };
}

export function refreshCoverage(reloadRequested, reload) {
  if (!reloadRequested) return { ok: true, reason: null };
  if (reload?.classification !== 'stable-match') return { ok: false, reason: `reload classification is ${reload?.classification ?? 'missing'}` };
  if (!reload?.ran) return { ok: false, reason: 'reload did not run' };
  if (!isValidRevision(reload.revision)) return { ok: false, reason: 'reload recorded no valid displayed revision' };
  const identities = seatIdentities(reload.seats);
  const conflict = [...identities].find(([, names]) => names.size > 1);
  if (conflict) return { ok: false, reason: `reload recorded conflicting names for seat ${conflict[0]}` };
  if (identities.size < 2) return { ok: false, reason: 'reload compared fewer than two distinct players' };
  const refreshedNumber = seatNumber(reload.refreshedSeat);
  if (!refreshedNumber) return { ok: false, reason: 'reload recorded no refreshed seat' };
  if (!identities.has(refreshedNumber)) return { ok: false, reason: 'reload did not include the refreshed seat' };
  if (!Number.isInteger(reload.rowsCompared) || reload.rowsCompared <= 0) return { ok: false, reason: 'reload compared no valid rows' };
  if (reload?.navigation?.observed !== true) return { ok: false, reason: 'reload navigation not observed' };
  if (reload?.session?.present !== true) return { ok: false, reason: 'session not persisted after reload' };
  if (!reload?.attempts) return { ok: false, reason: 'reload attempts file missing' };
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
