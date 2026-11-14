// Treat every .js file as an ES module, and neutralise the app entry's root render
// (the only in-memory rewrite: `X(document.getElementById("root")).render(` -> a no-op render).
import { registerHooks } from 'node:module';
registerHooks({
  load(url, ctx, next) {
    const r = next(url, ctx);
    if (url.startsWith('file:') && url.endsWith('.js')) {
      r.format = 'module';
      if (/\/index-[\w-]+\.js$/.test(url)) {
        const src = String(r.source);
        const out = src.replace(/[\w$]+\(document\.getElementById\("root"\)\)\.render\(/, '({render(){}}).render(');
        if (out !== src) process.env.ORACLE_ROOT_RENDER_STUBBED = '1';
        r.source = out;
      }
    }
    return r;
  },
});
