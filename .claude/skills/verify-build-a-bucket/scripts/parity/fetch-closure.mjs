// Fetch the original's public source files (and their relative-import closure) at the pinned commit.
// Usage: node scripts/fetch-closure.mjs <outDir> <treeJson> <entry> [<entry>...]
// Files are treated as data: only read as text and scanned for import specifiers. Nothing is executed.
import fs from 'node:fs';
import path from 'node:path';

const SHA = '92cb2a155bb2261cd68038ac366b994ad5dbb873';
const REPO = 'GrahamEves-1210/build-a-player';
const [outDir, treeJson, ...entries] = process.argv.slice(2);
const tree = new Set(JSON.parse(fs.readFileSync(treeJson, 'utf8')).tree.filter((x) => x.type === 'blob').map((x) => x.path));
const STOP = new Set((process.env.STOP || '').split(',').filter(Boolean));

function resolve(fromFile, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  for (const c of [base, base + '.js', base + '.jsx', base + '.json', base + '/index.js', base + '/index.jsx']) if (tree.has(c)) return c;
  return null;
}

async function get(p) {
  for (const url of [`https://cdn.jsdelivr.net/gh/${REPO}@${SHA}/${p}`, `https://raw.githubusercontent.com/${REPO}/${SHA}/${p}`]) {
    const r = await fetch(url);
    if (r.ok) return { text: await r.text(), via: new globalThis.URL(url).host };
  }
  throw new Error('unfetchable ' + p);
}

const seen = new Set(), queue = [...entries], log = [];
while (queue.length) {
  const p = queue.shift();
  if (seen.has(p)) continue;
  seen.add(p);
  const dest = path.join(outDir, p);
  let text;
  if (fs.existsSync(dest)) text = fs.readFileSync(dest, 'utf8');
  else {
    const g = await get(p);
    text = g.text;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    log.push(`${g.via} ${p}`);
  }
  if (STOP.has(p) || !/\.(js|jsx)$/.test(p)) continue;
  const specs = [...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2]);
  for (const s of specs) {
    const r = resolve(p, s);
    if (r && !/\.(css|svg|png)$/.test(r)) queue.push(r);
  }
}
console.log(log.join('\n'));
console.log(`files in closure: ${seen.size}`);
