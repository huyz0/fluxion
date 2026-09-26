import { expect, it } from 'vitest';
import { VERSION } from './index.js';

it('NFR-MNT-004 smoke: @fluxion/editor exports its version', () => {
  expect(VERSION).toBe('0.0.0');
});
