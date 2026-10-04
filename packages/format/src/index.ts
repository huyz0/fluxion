/**
 * `@fluxion/format` — .flux zip, .flux.html and .flux.json read/write, content-addressed asset store, sanitizers, lockfile.
 *
 * @packageDocumentation
 */

export { MAX_SVG_CHARS, sanitizeSvg } from './sanitize-svg.js';
export { readZip, writeZip, type ZipEntry, type ZipFailure, type ZipInput, type ZipLimits, type ZipMethod } from './zip.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
