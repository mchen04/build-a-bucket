export interface Diff {
  path: string;
  oracle: unknown;
  ours: unknown;
}

export interface CompareResult {
  matched: number;
  total: number;
  diffs: Diff[];
}

const TOLERANCE = 1e-9;

function close(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
}

export function compare(oracle: unknown, ours: unknown, path = '', out?: CompareResult): CompareResult {
  const result = out ?? { matched: 0, total: 0, diffs: [] };
  const label = (key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);
  if (Array.isArray(oracle) || Array.isArray(ours)) {
    const a = Array.isArray(oracle) ? oracle : [];
    const b = Array.isArray(ours) ? ours : [];
    if (a.length !== b.length) {
      result.total += 1;
      result.diffs.push({ path: `${path}.length`, oracle: a.length, ours: b.length });
    }
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
      if (index >= a.length || index >= b.length) {
        result.total += 1;
        continue;
      }
      compare(a[index], b[index], `${path}[${index}]`, result);
    }
    return result;
  }
  if (oracle !== null && ours !== null && typeof oracle === 'object' && typeof ours === 'object') {
    const a = oracle as Record<string, unknown>;
    const b = ours as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(key in a) || !(key in b)) {
        result.total += 1;
        result.diffs.push({ path: label(key), oracle: a[key] ?? '<missing>', ours: b[key] ?? '<missing>' });
        continue;
      }
      compare(a[key], b[key], label(key), result);
    }
    return result;
  }
  result.total += 1;
  const same =
    typeof oracle === 'number' && typeof ours === 'number' ? close(oracle, ours) : Object.is(oracle, ours);
  if (same) result.matched += 1;
  else if (result.diffs.length < 12) result.diffs.push({ path, oracle, ours });
  return result;
}

export function describe(result: CompareResult): string {
  const lines = [`${result.matched}/${result.total} fields match`];
  for (const diff of result.diffs) lines.push(`  first diff ${diff.path}: oracle=${JSON.stringify(diff.oracle)} ours=${JSON.stringify(diff.ours)}`);
  return lines.join('\n');
}
