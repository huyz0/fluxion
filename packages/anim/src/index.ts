/**
 * `@fluxion/anim` — Animation, timeline and interaction model evaluation: sampling at time t, build-state reduction, morph, rider LUTs, expressions.
 *
 * @packageDocumentation
 */

export { type BuildEffect, type BuildGroup, type BuildState, type BuildStep, type Builds, compileBuilds, reduceBuild } from './builds.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
