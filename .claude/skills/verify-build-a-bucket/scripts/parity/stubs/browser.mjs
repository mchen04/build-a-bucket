// Heavier browser surface for importing the deployed Vite chunks.
const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, children: [], childNodes: [] },
  { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (k === 'nodeType' ? 1 : (() => el())) : undefined) });
const doc = globalThis.document;
Object.assign(doc, { getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], createElement: () => el(), createTextNode: () => el(), head: el(), body: el(), cookie: '', readyState: 'complete', location: { href: 'https://build-a-player.com/bucket', pathname: '/bucket', search: '', hash: '', origin: 'https://build-a-player.com', host: 'build-a-player.com', hostname: 'build-a-player.com', protocol: 'https:' } });
globalThis.location ??= doc.location;
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 16);
globalThis.cancelAnimationFrame ??= globalThis.clearTimeout;
globalThis.history ??= { pushState() {}, replaceState() {}, state: null };
globalThis.screen ??= { width: 390, height: 844 };
globalThis.innerWidth ??= 390; globalThis.innerHeight ??= 844;
globalThis.HTMLElement ??= class {}; globalThis.Element ??= class {}; globalThis.Node ??= class {};
globalThis.IntersectionObserver ??= class { observe() {} disconnect() {} unobserve() {} };
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
globalThis.MutationObserver ??= class { observe() {} disconnect() {} };
// never touch the network from executed bundle code
globalThis.fetch = async () => { throw new Error('network disabled in oracle'); };
globalThis.WebSocket = class { constructor() { throw new Error('network disabled in oracle'); } };
Object.assign(doc, { getElementsByTagName: () => [], getElementsByClassName: () => [], documentElement: el(), activeElement: null, hidden: false, title: '', referrer: '', fonts: { ready: Promise.resolve(), load: async () => [] } });
globalThis.addEventListener ??= () => {}; globalThis.removeEventListener ??= () => {}; globalThis.dispatchEvent ??= () => true;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.Image ??= class { set src(v) {} };
globalThis.AudioContext ??= class { createGain() { return el(); } };
for (const n of ['HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLCanvasElement', 'HTMLImageElement', 'SVGElement', 'Text', 'Event', 'EventTarget', 'DocumentFragment', 'ShadowRoot', 'Document', 'Window'])
  globalThis[n] ??= class {};
