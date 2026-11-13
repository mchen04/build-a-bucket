// BucketSalaryCap.jsx module-private HARDCODED_GRIDS and budgetForDateStr via ORACLE_EXPOSE.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const cap = await import(pathToFileURL(path.resolve(process.argv[2], 'src/components/BucketSalaryCap.jsx')).href);
const G = cap.__oracle_HARDCODED_GRIDS;
console.log(JSON.stringify({ dates: Object.keys(G), first: Object.fromEntries(Object.entries(G).map(([k, g]) => [k, g.map((c) => c[0].name)])), budgets: ['2026-07-15', '2026-07-16', '2026-07-17', '2026-11-13'].map(cap.__oracle_budgetForDateStr) }));
process.exit(0);
