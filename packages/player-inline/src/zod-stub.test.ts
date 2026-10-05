import { describe, expect, it } from 'vitest';
import { z } from './zod-stub.js';

describe('the zod stand-in of the one-file script (ADR-0026 amendment, NFR-SEC-001)', () => {
  it('NFR-SIZE-001: schemas can be built and chained while a package loads, and build nothing', () => {
    const schema = z
      .object({ a: z.string().min(1).optional(), b: z.array(z.number().int()), c: z.enum(['x', 'y']) })
      .extend({ d: z.literal(1) })
      .strict();
    expect(typeof schema).toBe('function');
    expect(new z.ZodError()).toBeDefined();
  });

  it('NFR-SEC-001: every check throws, so a use that was missed fails and never lets a value through unchecked', () => {
    const schema = z.object({ a: z.string() });
    for (const check of ['parse', 'safeParse', 'parseAsync', 'safeParseAsync', 'spa', 'decode', 'encode', 'safeDecode']) {
      expect(() => schema[check]({ a: 1 }), check).toThrow(/zod is not in the one-file player/);
    }
  });

  it('NFR-SEC-001: nothing is an instance of a stand-in class, and the hidden entry points of a schema are refused like the checks', () => {
    expect({} instanceof z.ZodError).toBe(false);
    expect(new Error('x') instanceof z.ZodError).toBe(false);
    const schema = z.object({ a: z.string() });
    expect(() => schema['~standard']).toThrow(/zod is not in the one-file player/);
    expect(() => schema._zod).toThrow(/zod is not in the one-file player/);
  });

  it('NFR-REL-002: it is not thenable, and a registry finds no metadata', async () => {
    await expect(Promise.resolve(z.string())).resolves.toBe(z.string());
    expect(z.globalRegistry.get(z.string())).toBeUndefined();
  });
});
