// Randomness for new ids (a module of its own: the save path and the bootstrap both need it, and neither should pull in the other).
import type { Random } from '@fluxion/schema';

/**
 * Randomness for new ids from the platform's cryptographic source.
 *
 * @public
 */
export const cryptoRandom: Random = {
  next: () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32,
};
