import { expect, it } from 'vitest';
import { allowsShapePackContentLicense, shapePackContentLicenses } from '../index.js';

it('NFR-LIC-003: content permits the repository allowlist without granting named optional code-pack exceptions', () => {
  expect(shapePackContentLicenses).toEqual(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'MPL-2.0', 'OFL-1.1', 'CC0-1.0', 'CC-BY-4.0']);
  expect(Object.isFrozen(shapePackContentLicenses)).toBe(true);
  for (const id of shapePackContentLicenses) expect(allowsShapePackContentLicense(id), id).toBe(true);
  for (const id of ['GPL-3.0-only', 'AGPL-3.0-only', 'BUSL-1.1', 'EPL-2.0', 'LGPL-3.0-only', 'Unknown']) {
    expect(allowsShapePackContentLicense(id), id).toBe(false);
  }
});

it('NFR-LIC-003: SPDX precedence and parentheses retain every AND obligation and allow permitted OR alternatives', () => {
  for (const text of ['MIT AND ISC', 'GPL-3.0-only OR MIT', 'MIT OR GPL-3.0-only AND ISC', '(MIT OR GPL-3.0-only) AND ISC', 'MIT WITH LLVM-exception']) {
    expect(allowsShapePackContentLicense(text), text).toBe(true);
  }
  for (const text of ['MIT AND GPL-3.0-only', '(MIT OR ISC) AND GPL-3.0-only', 'GPL-3.0-only WITH Classpath-exception-2.0']) {
    expect(allowsShapePackContentLicense(text), text).toBe(false);
  }
});

it('NFR-LIC-003 NFR-SEC-007: malformed or oversized SPDX input fails closed without unbounded recursion', () => {
  for (const text of [
    '',
    ' ',
    'MIT ISC',
    'MIT OR',
    'OR MIT',
    '(MIT',
    'MIT)',
    'MIT WITH',
    'MIT WITH AND',
    'free text license',
    '()',
    'MIT;',
    'MIT OR ISC;',
    'MIT OR (ISC',
  ]) {
    expect(allowsShapePackContentLicense(text), text).toBe(false);
  }
  expect(Reflect.apply(allowsShapePackContentLicense, undefined, [null])).toBe(false);
  for (const text of ['MIT'.padEnd(4097), `${'('.repeat(33)}MIT${')'.repeat(33)}`, Array(129).fill('MIT').join(' OR ')]) {
    expect(allowsShapePackContentLicense(text)).toBe(false);
  }
});

it('NFR-LIC-003 NFR-SEC-007: bounded SPDX expressions remain accepted at the documented limits', () => {
  for (const text of ['MIT'.padEnd(4096), `${'('.repeat(32)}MIT${')'.repeat(32)}`, Array(128).fill('MIT').join(' OR '), 'MIT and (ISC or GPL-3.0-only)']) {
    expect(allowsShapePackContentLicense(text)).toBe(true);
  }
});
