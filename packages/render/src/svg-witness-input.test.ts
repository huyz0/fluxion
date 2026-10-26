import { LIGHT_THEME } from '@fluxion/theme';
import { expect, it, vi } from 'vitest';
import { snapshotWitnessContext } from './svg-witness-input.js';

it('NFR-SEC-001: snapshots a valid bounded theme independently of caller mutation', () => {
  const theme = JSON.parse(JSON.stringify(LIGHT_THEME));
  const result = snapshotWitnessContext(theme, []);
  expect(result).toBeDefined();
  theme.name = 'changed';
  expect(result?.theme.name).toBe(LIGHT_THEME.name);
  expect(Object.isFrozen(result?.theme.tokens)).toBe(true);
});
it('NFR-SEC-001: rejects cyclic, overdeep and overlarge context before schema traversal', () => {
  const cycle: Record<string, unknown> = {};
  cycle['cycle'] = cycle;
  expect(snapshotWitnessContext(cycle, [])).toBeUndefined();
  let deep: unknown = {};
  for (let i = 0; i < 34; i++) deep = { child: deep };
  expect(snapshotWitnessContext(deep, [])).toBeUndefined();
  expect(snapshotWitnessContext({ ...LIGHT_THEME, name: 'x'.repeat(262145) }, [])).toBeUndefined();
  expect(snapshotWitnessContext({ tokens: Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [String(i), {}])) }, [])).toBeUndefined();
});
it('NFR-SEC-001: theme and font accessors are refused without invoking them', () => {
  const get = vi.fn(() => LIGHT_THEME.tokens);
  expect(snapshotWitnessContext(Object.defineProperty({ ...LIGHT_THEME }, 'tokens', { get }), [])).toBeUndefined();
  expect(get).not.toHaveBeenCalled();
  expect(snapshotWitnessContext(LIGHT_THEME, Object.defineProperty([], 0, { get }))).toBeUndefined();
  expect(get).not.toHaveBeenCalled();
});
it('NFR-SEC-001: resource caps and unsupported font profiles refuse before copying font buffers', () => {
  expect(
    snapshotWitnessContext(
      LIGHT_THEME,
      Array.from({ length: 9 }, () => ({})),
    ),
  ).toBeUndefined();
  expect(snapshotWitnessContext(LIGHT_THEME, [{ bytes: new Uint8Array(8 * 1024 * 1024 + 1) }])).toBeUndefined();
  expect(
    snapshotWitnessContext(LIGHT_THEME, [
      { family: 'Inter', weight: 400, style: 'normal', sha256: '0'.repeat(64), bytes: new Uint8Array([1]), profile: 'inter-latin-400-ascii' },
    ]),
  ).toBeUndefined();
});
