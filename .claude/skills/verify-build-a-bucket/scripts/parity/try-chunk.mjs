// Try importing a deployed chunk in Node with browser stubs. Usage: node --import ./scripts/register-browser.mjs scripts/try-chunk.mjs <chunkPath>
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const m = await import(pathToFileURL(path.resolve(process.argv[2])).href);
console.log('exports:', Object.keys(m).length, Object.keys(m).slice(0, 20).join(','));
setTimeout(() => process.exit(0), 500);
