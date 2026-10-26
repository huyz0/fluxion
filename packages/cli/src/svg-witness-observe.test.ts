import { readFileSync } from 'node:fs';
import type { SvgPaintRequest } from '@fluxion/format';
import { expect, it, vi } from 'vitest';
import type { Page } from './svg-witness-driver.js';
import { fitsWitnessRequest, observeWitnessPage } from './svg-witness-observe.js';

const samples = JSON.parse(readFileSync(new URL('../../format/src/__fixtures__/svg-paint-requests.json', import.meta.url), 'utf8')) as {
  request: SvgPaintRequest;
}[];
const request = samples[0]?.request;
if (!request) throw Error('missing canonical fixture');
function page(receipt: unknown): Page {
  return { evaluate: vi.fn(async () => receipt) } as unknown as Page;
}
it('NFR-SEC-001: Node bridge rejects extra receipt payload rather than forwarding unbounded browser data', async () => {
  await expect(observeWitnessPage(page({ identity: request.identity, status: 'painted', fontHashes: [], extra: 'unowned' }), request)).rejects.toThrow();
});
it('NFR-SEC-001: Node bridge refuses wrong identity and unexpected font hashes', async () => {
  await expect(observeWitnessPage(page({ identity: 'wrong', status: 'painted', fontHashes: [] }), request)).rejects.toThrow();
  await expect(observeWitnessPage(page({ identity: request.identity, status: 'painted', fontHashes: ['wrong'] }), request)).rejects.toThrow();
});
it('FR-LIB-004: Node receipt validation preserves the exact canonical receipt', async () => {
  const receipt = { identity: request.identity, status: 'painted', fontHashes: [] };
  expect(await observeWitnessPage(page(receipt), request)).toEqual(receipt);
  expect(fitsWitnessRequest(request)).toBe(true);
});
it('NFR-SEC-001: request transport size is refused before serialization', () => {
  expect(fitsWitnessRequest({ ...request, identity: 'x'.repeat(6 * 1024 * 1024) })).toBe(false);
});
