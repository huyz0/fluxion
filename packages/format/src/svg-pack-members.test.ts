// FR-LIB-004 NFR-SEC-001: the member rules of an SVG pack import (M18.174), shared by `fluxion pack-import` and the studio: a ZIP
// listed once under the batch bounds with strict names and no escaping member, ids and categories from member paths by one slug
// rule, and every non-SVG, empty-slug or colliding member refused, naming its path.
import { describe, expect, it } from 'vitest';
import { categoryOf, escapes, INPUT_LIMITS, memberIds, slugOf, writeZip, zipMembers } from './index.js';
import { encodeUtf8 } from './utf8.js';

const svg = encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg"/>');
const zip = (names: readonly string[]): Uint8Array => {
  const written = writeZip(names.map((name) => ({ name, bytes: name.endsWith('/') ? new Uint8Array() : svg })));
  if (!written.ok) throw new Error(written.error.reason);
  return written.value;
};

describe('zipMembers', () => {
  it('FR-LIB-004: lists the regular members in archive order, directory entries dropped', () => {
    const members = zipMembers(zip(['icons/', 'icons/a.svg', 'b.svg']));
    expect(Array.isArray(members) && members.map((m) => m.path)).toEqual(['icons/a.svg', 'b.svg']);
  });

  it('NFR-SEC-001: an absolute, backslash, empty, `.` or `..` member name is refused, naming it', () => {
    for (const name of ['/abs.svg', 'C:/x.svg', 'a\\b.svg', 'a//b.svg', './a.svg', 'a/../b.svg']) {
      expect(zipMembers(zip(['ok.svg', name]))).toEqual({ path: name, message: 'escapes the input: an absolute, backslash, empty, `.` or `..` name' });
      expect(escapes(name)).toBe(true);
    }
    expect(escapes('a/b.svg')).toBe(false);
  });

  it('NFR-SEC-001: bytes that are not a ZIP, or more entries than the cap, are refused for the whole input', () => {
    expect(zipMembers(svg)).toMatchObject({ path: '', message: expect.stringMatching(/^ZIP refused: /) });
    const many = Array.from({ length: INPUT_LIMITS.maxEntries + 1 }, (_, i) => `m${i}.svg`);
    expect(zipMembers(zip(many))).toMatchObject({ path: '', message: expect.stringMatching(/^ZIP refused: /) });
  });

  it('NFR-SEC-001: the bounds are the batch importer’s', () => {
    expect(INPUT_LIMITS).toEqual({ maxEntries: 4096, maxEntryBytes: 128 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
    expect(Object.isFrozen(INPUT_LIMITS)).toBe(true);
  });
});

describe('memberIds', () => {
  it('FR-LIB-004: one slug rule names ids; folders name categories', () => {
    expect(slugOf('a/b/My  Icon!.SVG')).toBe('my-icon');
    expect(slugOf('--x--.svg')).toBe('x');
    expect([categoryOf('ui/arrows/up.svg'), categoryOf('up.svg')]).toEqual(['ui/arrows', 'uncategorized']);
    const ids = memberIds([{ path: 'ui/Up Arrow.svg' }, { path: 'down.svg' }], 'acme');
    expect(ids instanceof Map && [...ids]).toEqual([
      ['ui/Up Arrow.svg', 'acme:up-arrow'],
      ['down.svg', 'acme:down'],
    ]);
  });

  it('NFR-SEC-001: a non-SVG member, an empty slug and two members with one id are each refused, naming the paths', () => {
    expect(memberIds([{ path: 'notes.txt' }, { path: '!!!.svg' }, { path: 'a/Up.svg' }, { path: 'b/up.svg' }], 'acme')).toEqual([
      { path: 'notes.txt', message: 'is not an SVG; every member of a pack-import must be one' },
      { path: '!!!.svg', message: 'its name gives no valid definition id ("acme:")' },
      { path: 'b/up.svg', message: 'gives the id acme:up, as a/Up.svg does' },
    ]);
  });
});
