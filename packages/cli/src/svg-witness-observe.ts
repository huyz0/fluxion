import type { SvgPaintReceipt, SvgPaintRequest } from '@fluxion/format';
import type { Page } from './svg-witness-driver.js';
import type { WitnessClientState } from './svg-witness-page.js';

/** Conservative JSON transport bound over a canonical, owned parser result. */
export function fitsWitnessRequest(request: SvgPaintRequest): boolean {
  const pending: unknown[] = [request];
  let size = 0;
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') size += value.length * 6 + 2;
    else if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      size += entries.reduce((n, [key]) => n + key.length * 6 + 8, 2);
      for (const [, child] of entries) pending.push(child);
    } else size += 32;
    if (size > 32 * 1024 * 1024) return false;
  }
  return true;
}
export async function observeWitnessPage(page: Page, request: SvgPaintRequest): Promise<SvgPaintReceipt> {
  const receipt = await page.evaluate(async (value) => {
    const client = globalThis as unknown as WitnessClientState;
    if (!client.fluxionSvgWitnessSession) throw Error('missing browser witness');
    return client.fluxionSvgWitnessSession.witness(value);
  }, request);
  if (!receipt || typeof receipt !== 'object' || Object.keys(receipt).length !== 3) throw Error('invalid receipt shape');
  if (receipt.identity !== request.identity || !['painted', 'no-witness', 'unsupported'].includes(receipt.status) || !Array.isArray(receipt.fontHashes))
    throw Error('invalid browser receipt');
  const expected = receipt.status === 'unsupported' ? [] : request.fonts.map((font) => font.sha256);
  if (receipt.fontHashes.length !== expected.length || receipt.fontHashes.some((hash, index) => hash !== expected[index])) throw Error('invalid font receipt');
  return receipt;
}
