import fs from 'node:fs';
import { createRequire } from 'node:module';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const esbuild = createRequire(import.meta.url)('esbuild');
const strip = (url) => url.split('#')[0].split('?')[0];

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new globalThis.URL(spec, ctx.parentURL));
      const stem = base.endsWith('.js') ? base.slice(0, -3) : base;
      const candidates = base.endsWith('.js')
        ? [`${stem}.ts`, `${stem}.tsx`, `${stem}.json`, base]
        : [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, `${base}/index.ts`, `${base}/index.tsx`];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          const url = pathToFileURL(candidate).href;
          return candidate.endsWith('.json') ? { url, shortCircuit: true } : { url, format: 'module', shortCircuit: true };
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    const clean = strip(url);
    if (url.startsWith('file:') && /\.tsx?$/.test(clean)) {
      const src = fs.readFileSync(fileURLToPath(clean), 'utf8');
      const loader = clean.endsWith('.tsx') ? 'tsx' : 'ts';
      return { format: 'module', source: esbuild.transformSync(src, { loader, format: 'esm', target: 'es2022' }).code, shortCircuit: true };
    }
    if (url.startsWith('file:') && clean.endsWith('.json')) {
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(clean), 'utf8')};`, shortCircuit: true };
    }
    return next(url, ctx);
  },
});
