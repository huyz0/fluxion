// What `zod` is in the one-file player's script (ADR-0026 amendment, M11.42). The packages the player bundles build their Zod schemas when they load (a record
// schema, a command's argument schema, a theme token schema) and ship as single files, so a bundler cannot prove those statements unused and keeps all of Zod
// (25 kB gzip of the file) for schemas nothing in the player calls: it reads a document with the lean reader (`@fluxion/format/player`) and writes none. This
// stand-in lets those statements run and build nothing: every property is the same inert value, which can be called, constructed and chained. The calls that
// would check a value (`parse` and its kin) throw, so a use that was missed fails a test and never lets a value through unchecked.
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
