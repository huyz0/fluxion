import { createSvgPaintRequest } from '@fluxion/format';
import { LIGHT_THEME } from '@fluxion/theme';
import { expect, it, vi } from 'vitest';
import { createWitnessFrame, mountWitness } from './svg-witness-frame.js';
import { snapshotWitnessContext } from './svg-witness-input.js';
import { serializeWitness } from './svg-witness-serialize.js';

it('FR-LIB-004: serialization round-trip refuses geometry corruption, even below pixel visibility', async () => {
  const cleanups: (() => void)[] = [];
  const scope = { alive: () => true, own: (cleanup: () => void) => cleanups.push(cleanup) };
  const frame = await createWitnessFrame(document, scope);
  const context = snapshotWitnessContext(LIGHT_THEME, []);
  const request = createSvgPaintRequest(
    {
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
      root: {
        name: 'svg',
        attributes: { viewBox: '0 0 100 100' },
        children: [{ name: 'circle', attributes: { cx: '50', cy: '50', r: '5', fill: 'red' }, children: [] }],
      },
    },
    [],
  );
  if (!context || !request.ok) throw Error('invalid test context');
  try {
    const artwork = mountWitness(frame, request.value, { ...context, styles: { color: 'black' } }, scope);
    expect(serializeWitness(frame, artwork, { context, request: request.value })).toContain('cx="50"');
    const original = frame.window.XMLSerializer.prototype.serializeToString;
    const spy = vi.spyOn(frame.window.XMLSerializer.prototype, 'serializeToString').mockImplementation(function (this: XMLSerializer, node) {
      return original.call(this, node).replace('cx="50"', 'cx="50.0001"');
    });
    try {
      expect(() => serializeWitness(frame, artwork, { context, request: request.value })).toThrow('serialized structure');
    } finally {
      spy.mockRestore();
    }
    const disabled = serializeWitness(frame, artwork, { context, request: request.value, disabled: true });
    const parsed = new frame.window.DOMParser().parseFromString(disabled, 'image/svg+xml');
    expect(parsed.documentElement.children).toHaveLength(0);
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
  }
});
