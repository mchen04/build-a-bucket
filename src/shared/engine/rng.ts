export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 1831565813) | 0;
    let s = Math.imul(a ^ (a >>> 15), 1 | a);
    s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function hashRng(seed: number): Rng {
  let h = seed | 0;
  return () => {
    h ^= h >>> 16;
    h = Math.imul(h, 0x45d9f3b) | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x119de1f3) | 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function teamPickHash(seed: number): number {
  let h = seed | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) | 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function seededRng(key: string): Rng {
  return mulberry32(hashString(key));
}

export function seededShuffle<T>(items: readonly T[], key: string): T[] {
  const rng = seededRng(key);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function weightedShuffle<T extends { w?: number }>(items: readonly T[], key: string): T[] {
  if (!items.some((item) => (item.w ?? 0) > 0 && item.w !== 1)) return seededShuffle(items, key);
  const rng = seededRng(key);
  return items
    .map((item) => ({ item, k: Math.pow(rng(), 1 / ((item.w ?? 0) > 0 ? (item.w as number) : 1)) }))
    .sort((a, b) => b.k - a.k)
    .map((entry) => entry.item);
}

export function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function randomSeed(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let tail = '';
  for (const byte of bytes) tail += (byte % 36).toString(36);
  return `b-${Date.now().toString(36)}-${tail}`;
}
