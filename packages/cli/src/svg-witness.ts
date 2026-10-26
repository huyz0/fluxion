import { readFile, stat } from 'node:fs/promises';
import { parseSvgPaintRequest, type SvgPaintRequest } from '@fluxion/format';
import { ok, type Result } from '@fluxion/schema';
import { createWitnessCleanup } from './svg-witness-cleanup.js';
import { controlWitness, type WitnessControl } from './svg-witness-control.js';
import type { Page } from './svg-witness-driver.js';
import { prepareWitnessInput } from './svg-witness-input.js';
import { connectWitnessBrowser, loadWitnessDriver, type WitnessBrowserConnection } from './svg-witness-launch.js';
import { fitsWitnessRequest, observeWitnessPage } from './svg-witness-observe.js';
import { prepareWitnessPage } from './svg-witness-page.js';
import {
  type NodeSvgWitnessFailure,
  type NodeSvgWitnessFailureKind,
  type NodeSvgWitnessOptions,
  type NodeSvgWitnessSession,
  nodeWitnessFailure,
} from './svg-witness-types.js';

export type { NodeSvgWitnessFailure, NodeSvgWitnessFailureKind, NodeSvgWitnessOptions, NodeSvgWitnessSession } from './svg-witness-types.js';

async function artifact(): Promise<string> {
  const path = new URL('./svg-witness.browser.js', import.meta.url);
  const info = await stat(path);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw Error('invalid browser artifact');
  return readFile(path, 'utf8');
}
function session(page: Page, control: WitnessControl): NodeSvgWitnessSession {
  let count = 0;
  const dispose = async (): Promise<Result<void, NodeSvgWitnessFailure>> => ((await control.dispose()) ? ok(undefined) : nodeWitnessFailure('cleanup'));
  const observeParsed = async (request: SvgPaintRequest) => {
    if (count >= 128) return nodeWitnessFailure('disposed');
    if (!fitsWitnessRequest(request)) return nodeWitnessFailure('invalid-input');
    const result = await control.run(async () => {
      count++;
      return observeWitnessPage(page, request);
    });
    if (!result.ok) return nodeWitnessFailure(result.kind);
    if (count >= 128 && !(await control.dispose())) return nodeWitnessFailure('cleanup');
    return result.value.status === 'unsupported' ? nodeWitnessFailure('unsupported') : ok(result.value);
  };
  return {
    dispose,
    observe: async (request) => {
      const parsed = parseSvgPaintRequest(request);
      return parsed.ok ? observeParsed(parsed.value) : nodeWitnessFailure('invalid-input');
    },
    witness: async (request) => {
      const parsed = parseSvgPaintRequest(request);
      if (!parsed.ok) return { identity: '', status: 'unsupported', fontHashes: [] };
      const result = await observeParsed(parsed.value);
      return result.ok ? result.value : { identity: parsed.value.identity, status: 'unsupported', fontHashes: [] };
    },
  };
}
const STARTUP_FAILURES = new Set(['transport', 'cancelled', 'cleanup']);
function startupFailure(cause: unknown): NodeSvgWitnessFailureKind {
  const kind = cause && typeof cause === 'object' ? Object.getOwnPropertyDescriptor(cause, 'kind')?.value : undefined;
  return typeof kind === 'string' && STARTUP_FAILURES.has(kind) ? (kind as NodeSvgWitnessFailureKind) : 'peer-missing';
}
/**
 * Create a bounded witness using the installed browser artifact and one owned loopback server.
 * Requires the optional Playwright peer and selected browser. Await dispose in finally;
 * cleanup failures are explicit, and no alternate engine or network rendering is attempted.
 * @public
 */
export async function createNodeSvgPaintWitness(options: NodeSvgWitnessOptions): Promise<Result<NodeSvgWitnessSession, NodeSvgWitnessFailure>> {
  const input = prepareWitnessInput(options.theme, options.fonts);
  const kind = options.browser ?? 'chromium';
  if (!input || !['chromium', 'firefox', 'webkit'].includes(kind)) return nodeWitnessFailure('invalid-input');
  if (options.signal?.aborted) return nodeWitnessFailure('cancelled');
  const cleanup = createWitnessCleanup();
  const control = controlWitness(cleanup, options.signal);
  let startupKind: NodeSvgWitnessFailureKind = 'peer-missing';
  const setup = await control.run(async () => {
    const driver = await loadWitnessDriver(kind);
    startupKind = 'transport';
    const bundle = await artifact();
    if (!control.alive()) throw Error('cancelled setup');
    startupKind = 'peer-missing';
    cleanup.launchStarted();
    let connection: WitnessBrowserConnection;
    try {
      connection = await connectWitnessBrowser(driver, {
        alive: control.alive,
        cleanup,
        own: (owned) => {
          if (!control.alive()) void owned.close();
        },
      });
    } catch (cause) {
      startupKind = startupFailure(cause);
      throw cause;
    } finally {
      cleanup.launchFinished();
    }
    startupKind = 'transport';
    return prepareWitnessPage(connection.browser, input, bundle, control);
  }, 118000);
  if (!setup.ok) return nodeWitnessFailure(setup.kind === 'transport' ? startupKind : setup.kind);
  if (!setup.value.accepted) return nodeWitnessFailure((await control.dispose()) ? 'invalid-input' : 'cleanup');
  return ok(session(setup.value.page, control));
}
