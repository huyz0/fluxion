import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Bytes, sha256Hex } from './sha256.js';
import { base62, idKeys, resolveSalt, sha256Hash128, stableId } from './stable-id.js';

const utf8 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');

describe('stable ids (ADR-0031, FR-DSL-002, NFR-REL-005)', () => {
  it('NFR-REL-005: SHA-256 matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex(utf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    // a million a's crosses many blocks and the 2^32-bit length word stays right
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    expect(hex(sha256Bytes(utf8('abc')))).toBe(sha256Hex(utf8('abc')));
  });

  it('FR-DSL-002: hash128 is the first 16 bytes of the SHA-256 of the UTF-8 text, and base62 writes 22 characters', () => {
    expect(hex(sha256Hash128.hash128('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223');
    // non-ASCII text is hashed as UTF-8: "é" is c3 a9
    expect(hex(sha256Hash128.hash128('é'))).toBe(sha256Hex(Uint8Array.from([0xc3, 0xa9])).slice(0, 32));
    expect(base62(new Uint8Array(16))).toBe('0000000000000000000000');
    expect(base62(Uint8Array.from([...new Uint8Array(15), 61]))).toBe('000000000000000000000z');
    expect(base62(Uint8Array.from([...new Uint8Array(15), 62]))).toBe('0000000000000000000010');
    // 2^128 - 1 is the largest value: it still fits 22 characters
    expect(base62(new Uint8Array(16).fill(255))).toBe('7n42DGM5Tflk9n8mt7Fhc7');
  });

  it('FR-DSL-002: the same salt and key give the same id, which is a valid record id', () => {
    const id = stableId(sha256Hash128, '', idKeys.node('api'));
    expect(id).toBe(stableId(sha256Hash128, '', 'node:api'));
    expect(id).toMatch(/^[0-9A-Za-z]{22}$/);
    // the salt and the key both change it
    expect(stableId(sha256Hash128, 'x', 'node:api')).not.toBe(id);
    expect(stableId(sha256Hash128, '', 'node:db')).not.toBe(id);
    // salt and key are joined with ':' (ADR-0031)
    expect(id).toBe(base62(sha256Hash128.hash128(':node:api')));
  });

  it("FR-DSL-002: a recompile salts with the base document's kept salt, else the given one, else the empty string", () => {
    // the base's salt wins over a given one, so a screen recompiled into the document keeps its ids
    expect(resolveSalt({ source: { salt: 'k3' } }, 'fresh')).toBe('k3');
    expect(resolveSalt({ source: { salt: '' } }, 'fresh')).toBe('');
    // a base without a FluxScript source (made in the editor) takes the given salt
    expect(resolveSalt({}, 'fresh')).toBe('fresh');
    expect(resolveSalt({ source: {} }, 'fresh')).toBe('fresh');
    // a first compile with no salt is a function of the source alone
    expect(resolveSalt(undefined)).toBe('');
    expect(resolveSalt(undefined, 'given')).toBe('given');
    // so the id of an unchanged node is the same before and after a recompile into the base
    const first = stableId(sha256Hash128, resolveSalt(undefined, 'k3'), idKeys.node('api'));
    expect(stableId(sha256Hash128, resolveSalt({ source: { salt: 'k3' } }, 'other'), idKeys.node('api'))).toBe(first);
  });

  it('FR-DSL-002: the key scheme names every record a compile makes, and repeated edges count from 2', () => {
    expect(idKeys.document()).toBe('document');
    expect(idKeys.theme('ocean')).toBe('theme:ocean');
    expect(idKeys.screen('arch')).toBe('screen:arch');
    expect(idKeys.node('pay')).toBe('node:pay');
    expect(idKeys.edge({ screen: 'arch', from: 'pay', op: '~>', to: 'queue' })).toBe('edge:arch:pay:~>:queue');
    expect(idKeys.edge({ screen: 'arch', from: 'pay', op: '~>', to: 'queue', n: 1 })).toBe('edge:arch:pay:~>:queue');
    expect(idKeys.edge({ screen: 'arch', from: 'pay', op: '~>', to: 'queue', n: 2 })).toBe('edge:arch:pay:~>:queue:2');
  });

  it('FR-DSL-002: distinct slugs over a 10k corpus give distinct ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(stableId(sha256Hash128, 'salt', idKeys.node(`n-${i}`)));
    expect(ids.size).toBe(10_000);
  });

  it('NFR-REL-005: base62 is a bijection on 16-byte values (order kept)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 16 }), fc.uint8Array({ minLength: 16, maxLength: 16 }), (a, b) => {
        const cmp = (x: Uint8Array, y: Uint8Array) => hex(x).localeCompare(hex(y));
        const sa = base62(a);
        const sb = base62(b);
        expect(sa).toHaveLength(22);
        // fixed width over an ordered alphabet: equal values give equal strings, and the order of the bytes is the order of the text
        expect(Math.sign(sa < sb ? -1 : sa > sb ? 1 : 0)).toBe(Math.sign(cmp(a, b)));
      }),
    );
  });
});
