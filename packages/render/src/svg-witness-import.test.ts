import { expect, it, vi } from 'vitest';

it('NFR-SEC-001: renderer, SSR and witness entries import without a DOM or resource timers', async () => {
  expect(typeof document).toBe('undefined');
  expect(typeof window).toBe('undefined');
  vi.useFakeTimers();
  try {
    const main = await import('@fluxion/render');
    const ssr = await import('@fluxion/render/ssr');
    const witness = await import('@fluxion/render/svg-witness');
    expect(main.ScreenView).toBeTypeOf('function');
    expect(ssr.renderDocumentToHtml).toBeTypeOf('function');
    expect(witness.createSvgPaintWitness).toBeTypeOf('function');
    expect(main).not.toHaveProperty('createSvgPaintWitness');
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
