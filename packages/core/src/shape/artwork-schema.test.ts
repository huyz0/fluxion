import { isSvgArtworkData } from '@fluxion/schema';
import { expect, it } from 'vitest';
import { checkedArtworkSchema } from './artwork-schema.js';

const valid = () => ({ viewBox: { x: 0, y: 0, width: 10, height: 10 }, root: { name: 'path', attributes: { d: 'M0 0L1 1' }, children: [] } });
it('NFR-SEC-001 FR-LIB-004: lean and schema boundaries agree on accepted and rejected structures', () => {
  const good = valid();
  for (const input of [good, { ...good, colors: { red: '{color.primary}' } }, { ...good, root: { name: 'text', attributes: {}, children: ['hello'] } }]) {
    expect(isSvgArtworkData(input)).toBe(true);
    expect(checkedArtworkSchema.safeParse(input)).toMatchObject({ success: true, data: input });
  }
  for (const input of [
    null,
    [],
    {},
    { ...good, extra: true },
    { ...good, viewBox: { ...good.viewBox, width: Infinity } },
    { ...good, viewBox: { ...good.viewBox, height: 0 } },
    { ...good, viewBox: { ...good.viewBox, extra: 1 } },
    { ...good, colors: { 'url(evil)': '{color.primary}' } },
    { ...good, colors: { red: 'var(--evil)' } },
    { ...good, root: { ...good.root, attributes: { d: 1 } } },
    { ...good, root: { ...good.root, children: [null] } },
    { ...good, root: { ...good.root, children: 'text' } },
    { ...good, root: { ...good.root, extra: true } },
  ]) {
    expect(isSvgArtworkData(input)).toBe(false);
    expect(checkedArtworkSchema.safeParse(input).success).toBe(false);
  }
});
