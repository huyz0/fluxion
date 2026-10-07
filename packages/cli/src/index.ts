/**
 * `@fluxion/cli` — The fluxion command: validate, compile, render, lint, layout, convert, catalog, pack, site build.
 *
 * @packageDocumentation
 */

export type { CliIo, ExitCode } from './command.js';
export { run } from './main.js';

import { CLI_VERSION } from './version.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = CLI_VERSION;
