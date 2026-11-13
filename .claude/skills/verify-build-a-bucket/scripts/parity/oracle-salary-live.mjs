// Salary board against the DEPLOYED bundle: progress chunk exports I = salaryKit, h = BUCKET_SAL_POOL,
// S = SAL_COLS, Y = salTypesFor (located by their literal shapes in the minified chunk).
// Usage: node --no-experimental-webstorage --import ./scripts/register-browser.mjs scripts/oracle-salary-live.mjs <progressChunk> <date> <infiniteSeed>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [chunk, date, inf = '1'] = process.argv.slice(2);
const m = await import(pathToFileURL(path.resolve(chunk)).href);
const kit = m.I({ typesFor: m.Y });
const grid = kit.dailyGrid(m.S, m.h, date);
// the hash RNG BucketSalaryCap.jsx / salaryCore.js seed boards with (0x45d9f3b / 0x119de1f3)
const mb = (seed) => { let h = seed | 0; return () => { h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) | 0; h ^= h >>> 16; h = Math.imul(h, 0x119de1f3) | 0; h ^= h >>> 16; return (h >>> 0) / 0x100000000; }; };
console.log(JSON.stringify({ grid: grid.map((col) => col.map((c) => `${c.price}:${c.name}`)), infinite: kit.generateGrid(m.S, m.h, mb(Number(inf)), new Set(), Number(inf)).map((c) => c[0].name) }));
process.exit(0);
