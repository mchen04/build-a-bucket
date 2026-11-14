// Generic stub for bare packages: a callable, chainable no-op.
const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === 'isNativePlatform' ? () => false : noop), apply: () => noop, construct: () => noop });
export default noop;
