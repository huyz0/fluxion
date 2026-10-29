// The renderer's paint witness as the SVG library importer's session port (FR-LIB-004, M18.17): each call starts one bounded
// session in the host's document (render's `createSvgPaintWitness`), and its synchronous, idempotent dispose is a clean close.
import { createSvgPaintWitness, type SvgWitnessOptions } from '@fluxion/render/svg-witness';
import { ok } from '@fluxion/schema';
import type { SvgLibraryOptions } from './import-svg.js';

/**
 * `startWitness` for {@link convertSvgLibrary}: a new renderer witness session under `options` per call, or why it could not start.
 *
 * @public
 */
export function svgWitnessStarter(options: SvgWitnessOptions): SvgLibraryOptions['startWitness'] {
  return async () => {
    const session = createSvgPaintWitness(options);
    if (!session.ok) return session;
    const { witness, dispose } = session.value;
    return ok({ witness, dispose: async () => ok(dispose()) });
  };
}
