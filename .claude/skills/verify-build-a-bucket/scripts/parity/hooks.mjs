// Node module hooks for running the original's source files unmodified.
// - relative extensionless specifiers resolve to .js/.jsx/.json/index.js
// - .json files load as `export default <json>`
// - .jsx files are transpiled (JSX only) with esbuild when ESBUILD points to an esbuild module
// - bare packages (react, @supabase/..., @capacitor/...) resolve to stubs/<name>.mjs
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const STUBS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'stubs');
// ORACLE_EXPOSE='{"bucketSimulation.js":["simulateSeries"]}' appends `export { simulateSeries as __oracle_simulateSeries }`
// to that file in memory, reaching module-private functions without editing the download.
const EXPOSE = JSON.parse(process.env.ORACLE_EXPOSE || '{}');
const expose = (url, src) => {
  const hit = Object.entries(EXPOSE).find(([f]) => url.endsWith('/' + f));
  return hit ? src + '\nexport { ' + hit[1].map((n) => `${n} as __oracle_${n}`).join(', ') + ' };\n' : src;
};
const esbuild = process.env.ESBUILD ? createRequire(import.meta.url)(process.env.ESBUILD) : null;

registerHooks({
  resolve(spec, ctx, next) {
    // stylesheets and images (never downloaded): an empty default export
    if (/\.(css|svg|png|jpe?g|webp|gif|mp3|wav)(\?.*)?$/.test(spec)) return { url: 'stub:asset?', format: 'module', shortCircuit: true };
    if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new globalThis.URL(spec, ctx.parentURL));
      for (const c of [base, base + '.js', base + '.jsx', base + '.json', base + '/index.js', base + '/index.jsx'])
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return { url: pathToFileURL(c).href, format: 'module', shortCircuit: true };
    }
    if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:') && !spec.startsWith('file:') && !spec.startsWith('stub:')) {
      // Stub a bare package with exactly the names the importing file asks for.
      const names = new Set();
      if (ctx.parentURL?.startsWith('file:')) {
        const text = fs.readFileSync(fileURLToPath(ctx.parentURL.split('#')[0]), 'utf8');
        const esc = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
        for (const m of text.matchAll(new RegExp('import\\s+([^;\'"]*?)\\s+from\\s*[\'"]' + esc + '[\'"]', 'g'))) {
          const braces = m[1].match(/\{([^}]*)\}/);
          if (braces) for (const part of braces[1].split(',')) { const n = part.trim().split(/\s+as\s+/)[0].trim(); if (n) names.add(n); }
        }
      }
      if (spec.endsWith('jsx-runtime')) ['jsx', 'jsxs', 'Fragment'].forEach(n => names.add(n));
      return { url: 'stub:' + encodeURIComponent(spec) + '?' + [...names].join(','), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.startsWith('stub:')) {
      const names = (url.split('?')[1] || '').split(',').filter(Boolean);
      const hand = path.join(STUBS, decodeURIComponent(url.slice(5).split('?')[0]).replace(/[/@]/g, '_') + '.mjs');
      if (fs.existsSync(hand)) return { format: 'module', source: fs.readFileSync(hand, 'utf8'), shortCircuit: true };
      return { format: 'module', source: "import noop from " + JSON.stringify(pathToFileURL(path.join(STUBS, '_generic.mjs')).href) + ";\nexport default noop;\n" + names.map(n => `export const ${n} = noop.${n};`).join('\n'), shortCircuit: true };
    }
    if (url.startsWith('file:') && /\.json$/.test(url.split('#')[0]))
      return { format: 'module', source: 'export default ' + fs.readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
    if (url.startsWith('file:') && /\.jsx$/.test(url)) {
      if (!esbuild) throw new Error('JSX needs ESBUILD=<path to esbuild package>: ' + url);
      const src = fs.readFileSync(fileURLToPath(url), 'utf8');
      const out = "import.meta.env = { DEV: false, PROD: true, MODE: 'production', BASE_URL: '/', SSR: false };" + esbuild.transformSync(src, { loader: 'jsx', jsx: 'automatic', format: 'esm' }).code;
      return { format: 'module', source: expose(url, out), shortCircuit: true };
    }
    if (url.startsWith('file:') && /\.(css|svg|png)$/.test(url)) return { format: 'module', source: 'export default ""', shortCircuit: true };
    const r = next(url, ctx);
    if (url.startsWith('file:') && /\.js$/.test(url)) {
      // Vite's import.meta.env (production values), prefixed on line 1 so line numbers are unchanged
      const src = String(r.source);
      r.format = 'module';
      r.source = expose(url, src.includes('import.meta.env') ? "import.meta.env = { DEV: false, PROD: true, MODE: 'production', BASE_URL: '/', SSR: false };" + src : src);
    }
    return r;
  },
});
