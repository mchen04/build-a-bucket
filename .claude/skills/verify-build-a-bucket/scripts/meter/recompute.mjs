import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] ?? 'evidence/perf'
const files = fs.readdirSync(dir).filter((f) => /^meter-(base|rm)-\d-.*\.json$/.test(f)).sort()

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const fields = ['dbResponseBytes', 'dbRequestBytes', 'dbRequests', 'apiBytes', 'apiRequests']
const perFile = {}

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  const tag = j.tag.replace(/-\d$/, '')
  const seasonKeys = Object.keys(j.aggregate).filter((k) => k.startsWith('season-'))
  const row = { file: f, tag, run: j.tag, phases: seasonKeys.length, runs: j.runs }
  for (const fld of fields) {
    row[fld] = seasonKeys.reduce((a, k) => a + j.aggregate[k][fld].median, 0)
  }
  row.requestPlusResponse = row.dbRequestBytes + row.dbResponseBytes
  perFile[tag] ??= []
  perFile[tag].push(row)
}

const out = { dir, files: perFile, summary: {} }
for (const tag of Object.keys(perFile)) {
  const rows = perFile[tag]
  out.summary[tag] = {}
  for (const fld of [...fields, 'requestPlusResponse']) {
    const vals = rows.map((r) => r[fld])
    out.summary[tag][fld] = { perRun: vals, median: median(vals) }
  }
}

const b = out.summary.base
const r = out.summary.rm
out.delta = {}
for (const fld of [...fields, 'requestPlusResponse']) {
  const bm = b[fld].median
  const rm = r[fld].median
  out.delta[fld] = { base: bm, rm, diff: rm - bm, pct: ((rm - bm) / bm) * 100 }
}

console.log(JSON.stringify(out, null, 2))
