import { expect, it } from 'vitest';
import { prepareWitnessInput } from './svg-witness-input.js';

const theme = { name: 'bounded-context', tokens: { color: { $type: 'color', $value: '#fff' } } };
it('NFR-SEC-001: Node witness transport rejects cycles and accessors before serialization', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  expect(prepareWitnessInput(cyclic, [])).toBeUndefined();
  let read = false;
  const accessor = Object.defineProperty({}, 'tokens', {
    enumerable: true,
    get() {
      read = true;
      return {};
    },
  });
  expect(prepareWitnessInput(accessor, [])).toBeUndefined();
  expect(read).toBe(false);
});
it('NFR-SEC-001: Node witness transport bounds theme depth and aggregate text before cloning', () => {
  let deep: unknown = {};
  for (let i = 0; i < 33; i++) deep = { child: deep };
  expect(prepareWitnessInput(deep, [])).toBeUndefined();
  expect(prepareWitnessInput({ text: 'x'.repeat(262145) }, [])).toBeUndefined();
});
it('NFR-SEC-001: Node witness transport copies caller data and accounts for encoded size', () => {
  const made = prepareWitnessInput(theme, []);
  expect(made).toBeDefined();
  expect(made?.theme).toEqual(theme);
  expect(made?.theme).not.toBe(theme);
  expect(made?.encodedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
});
it('NFR-SEC-001: Node witness transport checks all font byte ceilings before encoding', () => {
  const font = { family: 'Pinned', weight: 400, style: 'normal', sha256: 'a'.repeat(64), profile: 'inter-latin-400-ascii', bytes: new Uint8Array(1) };
  expect(
    prepareWitnessInput(
      theme,
      Array.from({ length: 9 }, () => font),
    ),
  ).toBeUndefined();
  expect(prepareWitnessInput(theme, [{ ...font, bytes: new Uint8Array(8 * 1024 * 1024 + 1) }])).toBeUndefined();
  expect(
    prepareWitnessInput(theme, [
      { ...font, bytes: new Uint8Array(5 * 1024 * 1024) },
      { ...font, family: 'Other', bytes: new Uint8Array(4 * 1024 * 1024) },
    ]),
  ).toBeUndefined();
});
it('NFR-SEC-001: Node font transport owns binary bytes and never invokes font accessors', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const font = { family: 'Pinned', weight: 400, style: 'normal', sha256: 'a'.repeat(64), profile: 'inter-latin-400-ascii', bytes };
  const made = prepareWitnessInput(theme, [font]);
  expect(made?.fonts[0]?.base64).toBe('AQID');
  bytes.fill(0);
  expect(made?.fonts[0]?.base64).toBe('AQID');
  let read = false;
  Object.defineProperty(font, 'bytes', {
    get() {
      read = true;
      return bytes;
    },
  });
  expect(prepareWitnessInput(theme, [font])).toBeUndefined();
  expect(read).toBe(false);
});

it('NFR-SEC-001: sparse and oversized arrays refuse before transport while dense arrays remain bounded', () => {
  const sparse: number[] = [];
  sparse[10000000] = 0;
  expect(prepareWitnessInput({ tokens: { x: sparse } }, [])).toBeUndefined();
  expect(prepareWitnessInput({ x: Array(3) }, [])).toBeUndefined();
  const hole = [0, 1, 2];
  Reflect.deleteProperty(hole, '1');
  expect(prepareWitnessInput({ x: hole }, [])).toBeUndefined();
  expect(prepareWitnessInput({ x: Array.from({ length: 4097 }, () => 0) }, [])).toBeUndefined();
  const dense = { x: [0, null, ['value']], empty: [] };
  expect(prepareWitnessInput(dense, [])?.theme).toEqual(dense);
});
