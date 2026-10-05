import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIGHT_THEME } from './light.js';
import { isValidToken, themeOf } from './token-check.js';
import { themeSchema } from './tokens.js';

// values a field may hold: right ones, near misses and wrong types
const num = fc.oneof(
  fc.integer({ min: -3, max: 1200 }),
  fc.double({ noNaN: false }),
  fc.constantFrom(0, 1, -1, 0.5, 1.5, 1000, 1001, Number.NaN, Infinity, -Infinity, 2 ** 53),
);
const anything = fc.oneof(num, fc.string({ maxLength: 12 }), fc.constant(null), fc.constant(undefined), fc.boolean(), fc.array(num, { maxLength: 5 }));
const colour = fc.constantFrom(
  '#fff',
  '#ffffff80',
  'rgb(1 2 3)',
  'rebeccapurple',
  'red;background:url(x)',
  'url(javascript:1)',
  '{color.primary}',
  '{a.b',
  '',
  '#ggg',
);
const family = fc.constantFrom('Inter', 'A "B"', 'a<b', 'a\u0001b', '', '  ');
const unit = fc.constantFrom('px', 'ms', 'em', undefined);
const obj = (fields: { [k: string]: fc.Arbitrary<unknown> }) =>
  fc.record(fields, { requiredKeys: [] }).map((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
const value = fc.oneof(
  colour,
  family,
  num,
  anything,
  obj({ value: num, unit }),
  obj({ color: fc.oneof(colour, anything), offsetX: num, offsetY: num, blur: num, spread: num }),
  fc.array(fc.oneof(num, anything), { minLength: 0, maxLength: 5 }),
  fc.array(fc.oneof(family, anything), { minLength: 0, maxLength: 3 }),
);
const token = obj({
  $type: fc.constantFrom('color', 'dimension', 'fontFamily', 'fontWeight', 'number', 'shadow', 'duration', 'cubicBezier', 'nope', undefined),
  $value: value,
  $description: fc.oneof(fc.string({ maxLength: 4 }), fc.constant(undefined), num),
  $extensions: fc.oneof(fc.constant(undefined), fc.constant({}), fc.constant([]), fc.constant(3)),
});
const name = fc.constantFrom('a', 'b-c', 'a b', 'x.y', '', 'ok_1');
const group: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof({ depthSize: 'small' }, token, tie('group'), anything),
  group: fc.dictionary(name, tie('node'), { maxKeys: 3 }),
})).group;
const theme = fc.oneof(
  obj({
    name: fc.oneof(fc.constantFrom('t', ''), anything),
    tokens: group,
    defaults: fc.oneof(fc.constant(undefined), fc.constant({ shape: { fill: '{color.x}' } }), fc.constant({ shape: 3 }), anything),
  }),
  anything,
);

describe('the plain token and theme checks (FR-THM-001, NFR-SEC-001)', () => {
  it('FR-THM-001: isValidToken accepts exactly the tokens themeSchema accepts', () => {
    fc.assert(
      fc.property(token, (t) => {
        // a value with no `$value` is a group to the schema, which is its own question: compare tokens only
        if (typeof t === 'object' && t !== null && '$value' in t)
          expect(isValidToken(t), JSON.stringify(t)).toBe(themeSchema.safeParse({ name: 't', tokens: { a: t } }).success);
      }),
      { numRuns: 4000 },
    );
  });

  it('FR-THM-001: themeOf reads a theme exactly when themeSchema does, and to the same theme', () => {
    fc.assert(
      fc.property(theme, (t) => {
        const zod = themeSchema.safeParse(t);
        const lean = themeOf(t);
        expect(lean !== undefined, JSON.stringify(t)).toBe(zod.success);
        if (zod.success) expect(lean).toEqual(zod.data);
      }),
      { numRuns: 4000 },
    );
  });

  it('FR-THM-001: the built-in theme reads as itself, and a theme with two tokens on one CSS property is refused', () => {
    expect(themeOf(LIGHT_THEME)).toEqual(LIGHT_THEME);
    const token1 = { $type: 'number', $value: 1 };
    expect(themeOf({ name: 't', tokens: { a: { 'b-c': token1 }, 'a-b': { c: token1 } } })).toBeUndefined();
    expect(themeSchema.safeParse({ name: 't', tokens: { a: { 'b-c': token1 }, 'a-b': { c: token1 } } }).success).toBe(false);
  });

  it('NFR-SEC-001: a colour carrying other CSS is no token, however it is spelled', () => {
    for (const c of ['red;background:url(//x)', 'url(javascript:1)', 'rgb(1 2 3);x', '#fff}', 'expression(1)'])
      expect(isValidToken({ $type: 'color', $value: c }), c).toBe(false);
  });
});
