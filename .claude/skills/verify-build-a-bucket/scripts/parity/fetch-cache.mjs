import fs from 'node:fs';
import path from 'node:path';

const SHA = '92cb2a155bb2261cd68038ac366b994ad5dbb873';
const REPO = 'GrahamEves-1210/build-a-player';
const ENTRIES = [
  'src/utils/bucketSimulation.js',
  'src/lib/salaryCore.js',
  'src/data/nba-salary.js',
  'src/data/nba-guards.js',
  'src/data/nba-bigs.js',
  'src/data/nba-guard-legends.js',
  'src/data/nba-big-legends.js',
  'src/lib/squadSeason.js',
  'src/lib/squad.js',
  'src/lib/rng.js',
  'src/lib/verifyCore.js',
  'src/data/nba-teams.js',
  'src/lib/homeLook.js',
  'src/lib/progress.js',
  'src/components/SpinScreen.jsx',
  'src/components/BucketSimPage.jsx',
  'src/components/BucketApp.jsx',
  'src/components/BucketSalaryCap.jsx',
  'src/components/app/AppDaily.jsx',
];

function resolveIn(tree, fromFile, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.json`, `${base}/index.js`, `${base}/index.jsx`]) {
    if (tree.has(c)) return c;
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function ensureSource(cacheRoot, log = () => {}) {
  const srcRoot = path.join(cacheRoot, 'dl-src');
  const treeFile = path.join(cacheRoot, 'tree.json');
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (!fs.existsSync(treeFile)) {
    fs.writeFileSync(treeFile, await fetchText(`https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`));
    log(`tree cached at ${SHA.slice(0, 10)}`);
  }
  const tree = new Set(
    JSON.parse(fs.readFileSync(treeFile, 'utf8')).tree.filter((x) => x.type === 'blob').map((x) => x.path),
  );
  const queue = [...ENTRIES];
  const seen = new Set();
  let downloaded = 0;
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const dest = path.join(srcRoot, file);
      let text;
      if (fs.existsSync(dest)) text = fs.readFileSync(dest, 'utf8');
      else {
        text = await fetchText(`https://raw.githubusercontent.com/${REPO}/${SHA}/${file}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, text);
        downloaded++;
      }
      if (!/\.(js|jsx)$/.test(file)) continue;
      const specs = [
        ...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g),
      ].map((m) => m[1] || m[2]);
      for (const spec of specs) {
        const next = resolveIn(tree, file, spec);
        if (next && !/\.(css|svg|png|webp|gif)$/.test(next) && !seen.has(next)) queue.push(next);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  log(`source ready: ${seen.size} files (${downloaded} downloaded)`);
  return srcRoot;
}

export const ORACLE_SHA = SHA;
