import { describe, expect, it } from 'vitest';
import { library, rememberSaved } from './library-service.js';

describe('remembering a saved file (FR-FIL-008)', () => {
  it('FR-FIL-008: a saved file is kept under its name with its bytes and a WebP preview of its first screen', async () => {
    const records = {
      s: { id: 's', type: 'screen', index: 'a' },
      e: { id: 'e', type: 'element', kind: 'shape', screenId: 's', index: 'a', transform: { x: 0, y: 0, w: 960, h: 540 }, style: { fill: '#336699' } },
    };
    await rememberSaved({ name: 'service-test.flux', bytes: new Uint8Array([1, 2, 3]) }, records);
    const lib = await library();
    const got = await lib?.get('service-test.flux');
    expect(got?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(got?.thumb?.subarray(8, 12))).toBe('WEBP');
    await lib?.remove('service-test.flux');
  });

  it('FR-FIL-008: a document with no screen is kept without a preview, and a failure to keep never rejects', async () => {
    await rememberSaved({ name: 'no-screen.flux', bytes: new Uint8Array([4]) }, {});
    const lib = await library();
    const got = await lib?.get('no-screen.flux');
    expect(got?.thumb).toBeUndefined();
    await lib?.remove('no-screen.flux');
    await expect(rememberSaved({ name: 'bad.flux', bytes: (() => 1) as unknown as Uint8Array }, {})).resolves.toBeUndefined();
  });
});
