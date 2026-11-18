import fs from 'node:fs';
import path from 'node:path';

export async function recordNoBoundary({ seat, other, snapReload, proof, ev, reload }) {
  await snapReload(seat, 'before');
  if (other) await snapReload(other, 'before');
  await snapReload(seat, 'none');
  if (other) await snapReload(other, 'none');
  reload.classification = proof.classification;
  reload.reason = proof.reason;
  reload.samples = proof.attempts;
  reload.ran = false;
  fs.writeFileSync(path.join(ev, 'reload-attempts.json'), JSON.stringify({ classification: proof.classification, reason: proof.reason, revision: null, seats: [], rowsCompared: 0, samples: proof.attempts }, null, 2));
  reload.attempts = 'reload-attempts.json';
}
