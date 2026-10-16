/**
 * `@fluxion/cli` — The fluxion command: validate, compile, render, lint, layout, convert, catalog, pack, site build.
 *
 * @packageDocumentation
 */

export type { CliIo, ExitCode } from './command.js';
export { run } from './main.js';
export type { Browser, Launcher, Shot } from './render-png.js';
export { playwrightLauncher } from './render-png.js';
export { renderScreenPng, type ScreenImage, type ScreenImageResult } from './screen-png.js';

import { CLI_VERSION } from './version.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = CLI_VERSION;
