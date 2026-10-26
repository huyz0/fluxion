// Routing-only chunk stand-in (ADR-0026/0185). Standalone hosts retain real Zod validators.
// Routing imports schema declarations but never validates data; inert builders remove that
// unused runtime cost. Every validation entry point refuses instead of accepting unchecked input.
const CHECKS = new Set([
  'parse',
  'safeParse',
  'parseAsync',
  'safeParseAsync',
  'spa',
  'decode',
  'encode',
  'decodeAsync',
  'encodeAsync',
  'safeDecode',
  'safeEncode',
  'safeDecodeAsync',
  'safeEncodeAsync',
]);

/** The error a check raises in the player. */
function refused(name: string): never {
  throw new Error(`zod is not in the one-file player: .${name}() was called, and nothing here validates`);
}

// biome-ignore lint/suspicious/noExplicitAny: a stand-in for every shape of Zod's API
const inert: any = new Proxy(function stub() {}, {
  get(_target, key) {
    if (key === 'then') return undefined;
    if (typeof key === 'string' && CHECKS.has(key)) return () => refused(key);
    // a registry holds nothing: `z.globalRegistry.get(schema)` finds no metadata
    if (key === 'get') return () => undefined;
    if (key === Symbol.toPrimitive) return () => 'zod';
    // `x instanceof z.ZodError` is never true here, and the entry points the checks hide behind (`~standard`, `_zod`) are refused like the checks
    if (key === Symbol.hasInstance) return () => false;
    if (key === '~standard' || key === '_zod') return refused(String(key));
    return inert;
  },
  apply: () => inert,
  construct: () => inert,
});

/** The stand-in for Zod's `z` namespace. */
// biome-ignore lint/suspicious/noExplicitAny: a stand-in for every shape of Zod's API
export const z: any = inert;
