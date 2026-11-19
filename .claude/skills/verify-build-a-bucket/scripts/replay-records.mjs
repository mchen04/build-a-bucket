import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { revisionLabel } from './standings-check.mjs';
import { reloadCaptureBase, writeReloadAttempts } from './reload-boundary.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export function buildLeagueSummary(fields) {
  return {
    code: fields.code ?? null,
    players: fields.players,
    mode: fields.mode,
    era: fields.era ?? 'current',
    device: fields.device ?? 'iphone',
    viewport: fields.viewport ?? { width: 390, height: 844 },
    chaos: fields.chaos ?? { reload: null, away: null, hostLeave: false },
    reload: fields.reload ?? { ran: false, revision: null, seats: [], rowsCompared: 0, refreshedSeat: null, coverage: 'ok' },
    stages: fields.stages ?? [],
    phaseTimings: fields.phaseTimings ?? [],
    phaseDurations: fields.phaseDurations ?? [],
    marks: fields.marks ?? [],
    actions: fields.actions ?? [],
    gateWaits: fields.gateWaits ?? [],
    gateWaitTotals: fields.gateWaitTotals ?? [],
    seriesScores: fields.seriesScores ?? {},
    seriesTimeline: fields.seriesTimeline ?? {},
    pollGaps: fields.pollGaps ?? {},
    apiLatency: fields.apiLatency ?? [],
    champion: fields.champion ?? null,
    playAgain: fields.playAgain ?? false,
    rematchNote: fields.rematchNote ?? null,
    secondGameLog: fields.secondGameLog ?? null,
    errors: fields.errors ?? [],
    httpErrors: fields.httpErrors ?? [],
    evidence: fields.evidence ?? null,
  };
}

export function buildRunRecord(run) {
  return {
    label: run.name,
    players: run.players,
    mode: run.mode,
    device: run.device,
    reloadSeat: run.reloadSeat ?? null,
    awaySeat: run.awaySeat ?? null,
    hostLeave: run.hostLeave === true,
    command: run.command ?? '',
  };
}

export function buildMetaRecord({ head, out, babVerifyHome, port, e2ePort, suitePgPort }) {
  return { head, started: new Date().toISOString(), out, babVerifyHome, port, e2ePort, suitePgPort };
}

export function buildTrackedRecord({ pid, port, pgPort }) {
  return { pid, port, pgPort: pgPort ?? null };
}

export function buildCleanupLines({ pid, pgPort, e2ePort, suitePgPort, appGroup = 'clean', postgres = 'clean', probes }) {
  const value = (probe) => (probe === 'absent' ? 'no' : probe === 'present' ? 'yes' : 'unknown');
  const lines = [`pid=${pid}`, `pid_alive=${value(probes.pid)}`, `port_listening=${value(probes.port)}`];
  if (pgPort) lines.push(`pg_port_listening=${value(probes.pgPort)}`);
  if (e2ePort) lines.push(`e2e_port_listening=${value(probes.e2ePort)}`);
  if (suitePgPort) lines.push(`suite_pg_port_listening=${value(probes.suitePgPort)}`);
  lines.push(`app_group=${appGroup}`);
  lines.push(`postgres=${postgres}`);
  return lines;
}

function seatEntries(players, key) {
  return Array.from({ length: players }, (_, index) => ({ seat: index + 1, name: `P${index + 1}`, [key]: [] }));
}

function seatLabels(players) {
  return Array.from({ length: players }, (_, index) => `${index + 1}:P${index + 1}`);
}

function standingsRows() {
  return [
    Array.from({ length: 10 }, (_, index) => `${index + 1} T${index} 5-5`),
    Array.from({ length: 10 }, (_, index) => `${index + 1} U${index} 5-5`),
  ];
}

export function buildControlSummary(run) {
  const revision = { stage: 'Season', progress: '1 / 10' };
  const seats = seatLabels(run.players);
  const stages = [];
  if (run.reloadSeat !== null) stages.push({ label: 'after-reload', phase: 'Season', revision, seats, standings: standingsRows() });
  if (run.awaySeat !== null) stages.push({ label: 'away', seat: run.awaySeat, name: `P${run.awaySeat}` });
  if (run.hostLeave === true) stages.push({ label: 'host-left', seat: 1, name: 'P1' });
  stages.push({ label: 'recap', phase: 'Recap', champion: 'OKC are champions' });
  const summary = buildLeagueSummary({
    players: run.players,
    mode: run.mode,
    device: run.device,
    chaos: { reload: run.reloadSeat, away: run.awaySeat, hostLeave: run.hostLeave === true },
    reload:
      run.reloadSeat === null
        ? undefined
        : run.expectedClass === 'all-eliminated'
          ? { classification: 'no-held-boundary', ran: false, revision: null, seats: [], rowsCompared: 0, refreshedSeat: null, navigation: { observed: true }, attempts: null, coverage: 'no-held-boundary' }
          : { classification: 'stable-match', ran: true, revision, seats, rowsCompared: 20, refreshedSeat: { seat: run.reloadSeat, name: `P${run.reloadSeat}` }, navigation: { observed: true }, session: { present: true }, attempts: null, coverage: 'ok' },
    stages,
    marks: [{ label: 'recap', at: '2026-01-01T00:00:00.000Z' }],
    errors: seatEntries(run.players, 'errors'),
    httpErrors: seatEntries(run.players, 'responses'),
    champion: 'OKC are champions',
    playAgain: true,
  });
  if (run.fixture !== null && run.fixture !== undefined) {
    summary.fixture = { id: run.fixture, expectedClass: run.expectedClass, observedClass: run.expectedClass, qualifyingSeats: run.expectedClass === 'qualifying' ? [1] : [] };
  }
  return summary;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

export function buildControlFixture({ out, plan, head, pid = 123, port = 4391, pgPort = 55434, e2ePort = 4392, suitePgPort = 55435 }) {
  writeJson(path.join(out, 'plan.json'), plan);
  writeJson(path.join(out, 'meta.json'), buildMetaRecord({ head, out, babVerifyHome: path.join(out, 'bab-home'), port, e2ePort, suitePgPort }));
  writeJson(path.join(out, 'tracked.json'), buildTrackedRecord({ pid, port, pgPort }));
  writeJson(path.join(out, 'launch.json'), { head: head.slice(0, 7), pid, port, localDb: { pgPort } });
  writeText(path.join(out, 'launch.exit'), '0\n');
  writeText(path.join(out, 'cleanup.exit'), '0\n');
  writeText(
    path.join(out, 'cleanup-check.txt'),
    `${buildCleanupLines({ pid, pgPort, e2ePort, suitePgPort, appGroup: 'clean', postgres: 'clean', probes: { pid: 'absent', port: 'absent', pgPort: 'absent', e2ePort: 'absent', suitePgPort: 'absent' } }).join('\n')}\n`,
  );
  for (const step of plan.suite) {
    writeText(path.join(out, 'suite', step.id, 'command.txt'), `${step.command.join(' ')}\n`);
    writeText(path.join(out, 'suite', step.id, 'output.log'), 'ok\n');
    writeText(path.join(out, 'suite', step.id, 'exit'), '0\n');
    if (step.id === '04-test-local-db' || step.id === '05-e2e-local-db') {
      writeJson(path.join(out, 'suite', step.id, 'postgres-receipt.json'), { ok: true, services: [{ name: 'postgres', state: 'clean' }] });
      if (step.id === '05-e2e-local-db') {
        const suites = Object.entries(step.required?.projects ?? {}).flatMap(([project, files]) =>
          Object.entries(files).flatMap(([file, count]) =>
            Array.from({ length: count }, (_, index) => ({
              specs: [{ file: path.basename(file), title: `${file} test ${index}`, tests: [{ projectName: project, status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed' }] }] }],
            })),
          ),
        );
        writeJson(path.join(out, 'suite', step.id, 'report.json'), { config: { rootDir: path.join(REPO, 'e2e') }, suites });
      } else {
        const testResults = Object.entries(step.required?.files ?? {}).map(([name, count]) => ({
          name,
          assertionResults: Array.from({ length: count }, (_, index) => ({ fullName: `${name} test ${index}`, status: 'passed' })),
        }));
        writeJson(path.join(out, 'suite', step.id, 'report.json'), { testResults });
      }
    }
  }
  for (const run of plan.runs) {
    const runDir = path.join(out, 'runs', run.name);
    writeJson(path.join(runDir, 'run.json'), buildRunRecord(run));
    writeText(path.join(runDir, 'exit'), '0\n');
    const evidenceDir = path.join(runDir, 'evidence', 'league-2026-01-01T00-00-00-000Z-abc');
    const summary = buildControlSummary(run);
    if (run.reloadSeat !== null) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      const seats = seatLabels(run.players);
      const revision = summary.reload.revision;
      const samples = [
        { attempt: 0, ms: 0, recap: false, seats: [] },
        { attempt: 1, ms: 250, recap: false, seats: seats.map((label) => { const [seat, name] = label.split(':'); return { seat: Number(seat), name, revision: revisionLabel(revision), rows: 20 }; }) },
      ];
      summary.reload.attempts = writeReloadAttempts(evidenceDir, { classification: 'stable-match', reason: null, revision, seats: summary.reload.seats, rowsCompared: summary.reload.rowsCompared, samples });
      if (summary.reload.classification === 'stable-match') {
        const refreshed = summary.reload.refreshedSeat;
        const other = refreshed.seat === 1 ? { seat: 2, name: 'P2' } : { seat: 1, name: 'P1' };
        for (const seat of [refreshed, other]) {
          for (const phase of ['before', 'after']) {
            const base = reloadCaptureBase(phase, seat);
            writeText(path.join(evidenceDir, `${base}.png`), 'png');
            writeText(path.join(evidenceDir, `${base}.aria.txt`), '- main');
          }
        }
      }
    }
    writeJson(path.join(evidenceDir, 'summary.json'), summary);
  }
  return out;
}

function parseFlags(args) {
  const out = {};
  for (let index = 0; index < args.length; index += 2) out[args[index].replace(/^--/, '')] = args[index + 1];
  return out;
}

export function selectRunDir({ out, launchAttempted, verifyHome }) {
  let runDir = '';
  try {
    runDir = JSON.parse(fs.readFileSync(path.join(out, 'launch.json'), 'utf8')).run ?? '';
  } catch {
    runDir = '';
  }
  if (!runDir && launchAttempted) {
    try {
      const current = fs.readFileSync(path.join(verifyHome, 'current'), 'utf8').trim();
      if (current.startsWith(verifyHome + path.sep)) runDir = current;
    } catch {
      runDir = '';
    }
  }
  return runDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (command === 'cleanup') {
    console.log(
      buildCleanupLines({
        pid: Number(flags.pid),
        pgPort: flags['pg-port'] ? Number(flags['pg-port']) : null,
        e2ePort: flags['e2e-port'] ? Number(flags['e2e-port']) : null,
        suitePgPort: flags['suite-pg-port'] ? Number(flags['suite-pg-port']) : null,
        appGroup: flags['app-group'] ?? 'clean',
        postgres: flags.postgres ?? 'clean',
        probes: {
          pid: flags['pid-probe'],
          port: flags['port-probe'],
          pgPort: flags['pg-probe'],
          e2ePort: flags['e2e-probe'],
          suitePgPort: flags['suite-pg-probe'],
        },
      }).join('\n'),
    );
  } else if (command === 'run') {
    console.log(JSON.stringify(buildRunRecord({ name: flags.name, players: Number(flags.players), mode: flags.mode, device: flags.device, reloadSeat: flags.reload ? Number(flags.reload) : null, awaySeat: flags.away ? Number(flags.away) : null, hostLeave: flags['host-leave'] === 'true', command: flags.command ?? '' })));
  } else if (command === 'meta') {
    console.log(JSON.stringify(buildMetaRecord({ head: flags.head, out: flags.out, babVerifyHome: flags['bab-home'], port: Number(flags.port), e2ePort: Number(flags['e2e-port']), suitePgPort: Number(flags['suite-pg-port']) })));
  } else if (command === 'tracked') {
    console.log(JSON.stringify(buildTrackedRecord({ pid: Number(flags.pid), port: Number(flags.port), pgPort: flags['pg-port'] ? Number(flags['pg-port']) : null })));
  } else if (command === 'select-run-dir') {
    console.log(selectRunDir({ out: flags.out, launchAttempted: flags['launch-attempted'] === '1', verifyHome: flags['verify-home'] }));
  } else {
    console.error('usage: replay-records.mjs cleanup|run|meta|tracked|select-run-dir [--key value]');
    process.exit(2);
  }
}
