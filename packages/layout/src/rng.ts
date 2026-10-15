// The seeded random stream of a layout run (ADR-0034): sfc32, seeded from an integer through four splitmix32 outputs and twelve discarded draws.
// Layout code may use no other randomness; `Math.random` is forbidden in this package.

/** splitmix32: a stream of 32-bit words from one 32-bit state. */
function splitmix32(state: number): () => number {
  let a = state | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/**
 * The random stream of a layout run: numbers in [0, 1), the same for the same seed on every host.
 *
 * @public
 */
export function createRng(seed: number): () => number {
  const words = splitmix32(seed);
  let [a, b, c, d] = [words() | 0, words() | 0, words() | 0, words() | 0];
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next;
}
