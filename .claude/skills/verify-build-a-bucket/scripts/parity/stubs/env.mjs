// Browser globals some original modules touch at import time.
const mem = new Map();
globalThis.localStorage ??= { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear() };
globalThis.sessionStorage ??= globalThis.localStorage;
globalThis.window ??= globalThis;
globalThis.window.addEventListener ??= () => {};
globalThis.window.removeEventListener ??= () => {};
globalThis.document ??= { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', createElement: () => ({ style: {} }), documentElement: { style: {}, classList: { add() {}, remove() {} } } };
globalThis.import_meta_env = {};
// The oracles never touch the network.
globalThis.fetch = async () => { throw new Error('network disabled in oracle'); };
