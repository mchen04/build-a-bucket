import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function relativeSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const spec = match[1] as string;
    if (spec.startsWith('.')) found.push(spec);
  }
  return found;
}

function resolveSource(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  const mapped = base.endsWith('.js') ? base.slice(0, -3) : base;
  for (const candidate of [mapped, `${mapped}.ts`, path.join(mapped, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function apiEntries(): string[] {
  return walk(path.join(root, 'api')).sort();
}

function reachableFrom(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of relativeSpecifiers(file)) {
      const next = resolveSource(file, spec);
      if (next) queue.push(next);
    }
  }
  return [...seen].sort();
}

describe('api modules load under plain Node ESM', () => {
  it('every relative import reachable from api/ carries an explicit extension', () => {
    const reachable = reachableFrom(apiEntries());
    expect(reachable.length).toBeGreaterThan(apiEntries().length);
    const offenders: string[] = [];
    for (const file of reachable) {
      for (const spec of relativeSpecifiers(file)) {
        if (!/\.(js|json)$/.test(spec)) offenders.push(`${path.relative(root, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports every built api entry through Node ESM without error', async () => {
    const outDir = path.join(root, '.esm-check');
    const configPath = path.join(root, '.esm-check.tsconfig.json');
    rmSync(outDir, { recursive: true, force: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          noEmit: false,
          outDir: '.esm-check',
          rootDir: '.',
          types: ['node'],
        },
        include: ['api/**/*.ts'],
      }),
    );
    try {
      execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', configPath], {
        cwd: root,
        stdio: 'pipe',
      });
      for (const entry of apiEntries()) {
        const built = path.join(outDir, path.relative(root, entry).replace(/\.ts$/, '.js'));
        expect(existsSync(built), `${path.relative(root, entry)} was not emitted`).toBe(true);
        await import(pathToFileURL(built).href);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(configPath, { force: true });
    }
  }, 120000);
});
