import { expect, it } from 'vitest';
import { isSvgArtworkData } from './svg-artwork-data.js';

const wrap = (root: unknown) => ({ viewBox: { x: 0, y: 0, width: 100, height: 100 }, root });
it('NFR-SEC-001: structural schema rejects excessive paint depth and text nodes before core processing', () => {
  let root: unknown = { name: 'g', attributes: {}, children: [] };
  for (let i = 1; i < 64; i++) root = { name: 'g', attributes: {}, children: [root] };
  expect(isSvgArtworkData(wrap(root))).toBe(true);
  expect(isSvgArtworkData(wrap({ name: 'g', attributes: {}, children: [root] }))).toBe(false);
  expect(isSvgArtworkData(wrap({ name: 'text', attributes: {}, children: Array(20_000).fill('') }))).toBe(false);
});
