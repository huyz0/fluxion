import { expect, it } from 'vitest';
import { VERSION } from './index.js';

it('NFR-MNT-004 smoke: @fluxion/pack-infographic exports its version', () => {
  expect(VERSION).toBe('0.0.0');
});
