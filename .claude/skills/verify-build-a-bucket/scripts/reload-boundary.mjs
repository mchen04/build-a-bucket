import fs from 'node:fs';
import path from 'node:path';

export function reloadCaptureBase(phase, seat) {
  return `reload-${phase}-${seat.seat}-${seat.name}`;
}

export function writeReloadAttempts(ev, { classification, reason, revision, seats, rowsCompared, samples }) {
  fs.writeFileSync(path.join(ev, 'reload-attempts.json'), JSON.stringify({ classification, reason: reason ?? null, revision: revision ?? null, seats: seats ?? [], rowsCompared: rowsCompared ?? 0, samples: samples ?? [] }, null, 2));
  return 'reload-attempts.json';
}

export async function recordNoBoundary({ seat, other, snapReload, proof, ev, reload }) {
  await snapReload(seat, 'before');
  if (other) await snapReload(other, 'before');
  await snapReload(seat, 'none');
  if (other) await snapReload(other, 'none');
  reload.classification = proof.classification;
  reload.reason = proof.reason;
  reload.samples = proof.attempts;
  reload.ran = false;
  reload.attempts = writeReloadAttempts(ev, { classification: proof.classification, reason: proof.reason, revision: null, seats: [], rowsCompared: 0, samples: proof.attempts });
}
