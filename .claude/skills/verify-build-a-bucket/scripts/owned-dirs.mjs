import fs from 'node:fs';
import path from 'node:path';

export function removeOwnedDirs(dir, receiptOk) {
  if (!receiptOk) return;
  try {
    const init = JSON.parse(fs.readFileSync(path.join(dir, 'supervisor-init.json'), 'utf8'));
    if (init.dataDir) fs.rmSync(init.dataDir, { recursive: true, force: true });
    if (init.sockDir) fs.rmSync(init.sockDir, { recursive: true, force: true });
  } catch {}
}
