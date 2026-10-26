import { expect, it } from 'vitest';
import { createWitnessFrame, WITNESS_POLICY } from './svg-witness-frame.js';

it('NFR-SEC-001: the actual resource document blocks remote image and font loads under its own CSP', async () => {
  const cleanups: (() => void)[] = [];
  const frame = await createWitnessFrame(document, { alive: () => true, own: (cleanup) => cleanups.push(cleanup) });
  const violations: string[] = [];
  frame.document.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective));
  try {
    expect(frame.document.querySelector('meta')?.getAttribute('content')).toBe(WITNESS_POLICY);
    const image = frame.document.createElement('img');
    const failed = new Promise<void>((resolve, reject) => {
      image.onerror = () => resolve();
      image.onload = () => reject(Error('remote image loaded'));
    });
    image.src = 'https://witness.invalid/image.png';
    frame.document.body.append(image);
    await failed;
    const face = new frame.window.FontFace('BlockedProbe', 'url(https://witness.invalid/font.woff2)');
    frame.document.fonts.add(face);
    await expect(face.load()).rejects.toBeDefined();
    expect(violations).toContain('img-src');
    await expect.poll(() => violations).toContain('font-src');
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
  }
  expect(document.querySelector('[data-fluxion-svg-witness]')).toBeNull();
});
