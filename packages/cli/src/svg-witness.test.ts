import { expect, it, vi } from 'vitest';
import { createNodeSvgPaintWitness } from './svg-witness.js';
import { loadWitnessDriver } from './svg-witness-launch.js';

vi.mock('./svg-witness-launch.js', () => ({
  loadWitnessDriver: vi.fn(async () => {
    throw Error('peer unavailable');
  }),
  connectWitnessBrowser: vi.fn(),
}));
const theme = { name: 'plain', tokens: {} };
it('NFR-SEC-001: invalid Node context refuses before loading or launching a browser', async () => {
  vi.mocked(loadWitnessDriver).mockClear();
  const cyclic = { ...theme };
  Object.assign(cyclic, { self: cyclic });
  const result = await createNodeSvgPaintWitness({ theme: cyclic, fonts: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe('invalid-input');
  expect(loadWitnessDriver).not.toHaveBeenCalled();
});
it('NFR-SEC-001: already aborted Node creation allocates no process or timers', async () => {
  const controller = new AbortController();
  controller.abort();
  vi.mocked(loadWitnessDriver).mockClear();
  const result = await createNodeSvgPaintWitness({ theme, fonts: [], signal: controller.signal });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe('cancelled');
  expect(loadWitnessDriver).not.toHaveBeenCalled();
});
it('FR-LIB-004: absent optional browser peer has the existing peer-missing diagnostic', async () => {
  const result = await createNodeSvgPaintWitness({ theme, fonts: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe('peer-missing');
    expect(result.error.diagnostics[0]?.code).toBe('FLX_CLI_PEER_MISSING');
  }
});

it('NFR-SEC-001: sparse theme arrays refuse before browser driver allocation', async () => {
  vi.mocked(loadWitnessDriver).mockClear();
  const sparse: number[] = [];
  sparse[10000000] = 0;
  const invalid = { ...theme };
  Object.assign(invalid, { tokens: { x: sparse } });
  const result = await createNodeSvgPaintWitness({ theme: invalid, fonts: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe('invalid-input');
  expect(loadWitnessDriver).not.toHaveBeenCalled();
});
