import { readFileSync } from 'node:fs';
import type { SvgPaintRequest } from '@fluxion/format';
import { expect, it, vi } from 'vitest';
import { createNodeSvgPaintWitness } from './svg-witness.js';
import type { Browser, Page } from './svg-witness-driver.js';
import { connectWitnessBrowser, loadWitnessDriver, type WitnessBrowserDriver } from './svg-witness-launch.js';
import { prepareWitnessPage } from './svg-witness-page.js';

const hook = vi.hoisted(() => ({ afterRun: () => {} }));
vi.mock('./svg-witness-control.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./svg-witness-control.js')>();
  return {
    controlWitness: (...args: Parameters<typeof actual.controlWitness>) => {
      const control = actual.controlWitness(...args);
      return {
        ...control,
        run: async <T>(work: () => Promise<T>, budget?: number) => {
          const result = await control.run(work, budget);
          // Explicit deterministic injection at the real control's idle transition;
          // this is not native browser paint evidence.
          hook.afterRun();
          return result;
        },
      };
    },
  };
});
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({ isFile: () => true, size: 7 })),
  readFile: vi.fn(async () => 'trusted'),
}));
vi.mock('./svg-witness-launch.js', () => ({ loadWitnessDriver: vi.fn(), connectWitnessBrowser: vi.fn() }));
vi.mock('./svg-witness-page.js', () => ({ prepareWitnessPage: vi.fn() }));

it('NFR-SEC-001: request 129 cannot enter transport between request 128 completing and automatic disposal', async () => {
  const samples = JSON.parse(readFileSync(new URL('../../format/src/__fixtures__/svg-paint-requests.json', import.meta.url), 'utf8')) as {
    request: SvgPaintRequest;
  }[];
  const request = samples[0]?.request;
  if (!request) throw Error('missing canonical fixture');
  const evaluate = vi.fn(async () => ({ identity: request.identity, status: 'painted', fontHashes: request.fonts.map((f) => f.sha256) }));
  let exited = false;
  let onExit = () => {};
  const close = vi.fn(async () => {
    exited = true;
    onExit();
    return true;
  });
  vi.mocked(loadWitnessDriver).mockResolvedValue({} as WitnessBrowserDriver);
  vi.mocked(connectWitnessBrowser).mockImplementation(async (_driver, scope) => {
    scope.cleanup?.own({
      hasExited: () => exited,
      onExit: (listener) => {
        onExit = listener;
        return () => {
          onExit = () => {};
        };
      },
      close: async () => {
        await close();
      },
      kill: async () => {
        await close();
      },
    });
    scope.own({ close: scope.cleanup?.close ?? close });
    return { browser: {} as Browser, close };
  });
  vi.mocked(prepareWitnessPage).mockResolvedValue({ page: { evaluate } as unknown as Page, accepted: true });
  const made = await createNodeSvgPaintWitness({ theme: { name: 'plain', tokens: {} }, fonts: [] });
  if (!made.ok) throw Error(`fixture setup failed: ${made.error.kind}`);
  let extra: ReturnType<typeof made.value.observe> | undefined;
  try {
    for (let i = 0; i < 127; i++) expect((await made.value.observe(request)).ok).toBe(true);
    hook.afterRun = () => {
      if (evaluate.mock.calls.length === 128 && !extra) extra = made.value.observe(request);
    };
    expect((await made.value.observe(request)).ok).toBe(true);
    expect(extra).toBeDefined();
    expect((await extra)?.ok).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(128);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    hook.afterRun = () => {};
    await made.value.dispose();
  }
});
