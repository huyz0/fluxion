// FR-DOC-001 / NFR-SEC-001: each resource field is checked directly, so a dropped literal, bound,
// regex anchor or quantifier changes a verdict here.
import { describe, expect, it } from 'vitest';
import { assetRecordSchema, pluginRefRecordSchema, themeRecordSchema } from './resources.js';

const hash = 'a'.repeat(64);
const asset = { id: 'a1', type: 'asset', hash, mime: 'image/png', size: 1, name: 'x' };
const theme = { id: 't1', type: 'theme', name: 'T', tokens: {} };
const ref = { id: 'p1', type: 'plugin-ref', pluginId: 'acme', version: '1.2.3', trust: 'trusted' };
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;
const message = (schema: { safeParse(v: unknown): { error?: { issues: { message: string }[] } } }, value: unknown) =>
  schema.safeParse(value).error?.issues.map((i) => i.message);

describe('FR-DOC-001 NFR-SEC-001: resource records, field by field', () => {
  it('FR-DOC-001: each record takes its own type literal and keeps unknown fields', () => {
    expect(assetRecordSchema.parse({ ...asset, extra: 1 })).toEqual({ ...asset, extra: 1 });
    expect(themeRecordSchema.parse({ ...theme, extra: 1 })).toEqual({ ...theme, extra: 1 });
    expect(pluginRefRecordSchema.parse({ ...ref, extra: 1 })).toEqual({ ...ref, extra: 1 });
    expect(ok(assetRecordSchema, { ...asset, type: 'theme' })).toBe(false);
    expect(ok(themeRecordSchema, { ...theme, type: 'asset' })).toBe(false);
    expect(ok(pluginRefRecordSchema, { ...ref, type: 'asset' })).toBe(false);
    for (const [schema, value] of [
      [assetRecordSchema, asset],
      [themeRecordSchema, theme],
      [pluginRefRecordSchema, ref],
    ] as const)
      expect(ok(schema, { ...value, id: undefined })).toBe(false);
  });

  it('NFR-SEC-001: an asset hash is exactly 64 lower-case hex digits, with its own message', () => {
    expect(ok(assetRecordSchema, { ...asset, hash: '0123456789abcdef'.repeat(4) })).toBe(true);
    for (const bad of [`x${hash}`, `${hash}x`, 'a', 'g'.repeat(64), 'A'.repeat(64)]) expect(ok(assetRecordSchema, { ...asset, hash: bad }), bad).toBe(false);
    expect(message(assetRecordSchema, { ...asset, hash: 'a' })).toEqual(['expected a SHA-256 hash: 64 lower-case hex digits']);
  });

  it('NFR-SEC-001: an asset mime is type/subtype, with its own message', () => {
    for (const good of ['image/png', 'image/svg+xml', 'font/woff2', 'application/vnd.a-b.c', 'ab/C'])
      expect(ok(assetRecordSchema, { ...asset, mime: good }), good).toBe(true);
    for (const bad of ['png', 'Image/png', 'image/', '/png', 'image/png;x', ' image/png', '1/png', 'image/p g'])
      expect(ok(assetRecordSchema, { ...asset, mime: bad }), bad).toBe(false);
    expect(message(assetRecordSchema, { ...asset, mime: 'png' })).toEqual(['expected a media type such as image/png']);
  });

  it('FR-DOC-001: size is a whole number from zero; w and h are positive whole numbers', () => {
    for (const size of [0, 1, 1024]) expect(ok(assetRecordSchema, { ...asset, size }), String(size)).toBe(true);
    for (const size of [-1, 1.5]) expect(ok(assetRecordSchema, { ...asset, size }), String(size)).toBe(false);
    for (const k of ['w', 'h']) {
      expect(ok(assetRecordSchema, { ...asset, [k]: 2 }), k).toBe(true);
      expect(ok(assetRecordSchema, { ...asset, [k]: 0 }), k).toBe(false);
      expect(ok(assetRecordSchema, { ...asset, [k]: 1.5 }), k).toBe(false);
    }
    expect(ok(assetRecordSchema, { ...asset, name: undefined })).toBe(false);
  });

  it('NFR-SEC-001: an asset source is an http or https URL only', () => {
    for (const good of ['http://a.example/x', 'https://a.example/x']) expect(ok(assetRecordSchema, { ...asset, source: good }), good).toBe(true);
    for (const bad of ['ftp://a.example/x', 'xhttp://a.example', 'httpx://a.example', 'file:///x', 'javascript:alert(1)', 'not a url'])
      expect(ok(assetRecordSchema, { ...asset, source: bad }), bad).toBe(false);
  });

  it('FR-DOC-001: a theme has a name and a token tree, and optional defaults', () => {
    expect(ok(themeRecordSchema, { ...theme, defaults: { rect: {} } })).toBe(true);
    expect(ok(themeRecordSchema, { ...theme, defaults: 1 })).toBe(false);
    expect(ok(themeRecordSchema, { ...theme, tokens: 1 })).toBe(false);
    expect(ok(themeRecordSchema, { ...theme, name: undefined })).toBe(false);
  });

  it('NFR-SEC-001: a plugin id is a lower-case slug anchored at both ends', () => {
    for (const good of ['a', 'acme', 'a-1', '0x']) expect(ok(pluginRefRecordSchema, { ...ref, pluginId: good }), good).toBe(true);
    for (const bad of ['Acme', 'xA', 'a!', '-a', '', 'a b']) expect(ok(pluginRefRecordSchema, { ...ref, pluginId: bad }), bad).toBe(false);
  });

  it('FR-DOC-001: a plugin version is exact semver, with its own message', () => {
    for (const good of ['1.2.3', '10.20.30', '1.2.3-alpha', '1.2.3-a.b-c', '1.2.3+build', '1.2.3+b.1-x', '1.2.3-rc.1+b.2'])
      expect(ok(pluginRefRecordSchema, { ...ref, version: good }), good).toBe(true);
    for (const bad of ['^1.2.3', 'v1.2.3', '1.2.3x', '1.2', 'a.2.3', '1.a.3', '1.2.a', '1.2.3-', '1.2.3+', '1.2.3-a!', '1.2.3+a!'])
      expect(ok(pluginRefRecordSchema, { ...ref, version: bad }), bad).toBe(false);
    expect(message(pluginRefRecordSchema, { ...ref, version: '1.2' })).toEqual(['expected an exact semver version']);
  });

  it('NFR-SEC-001: integrity is an anchored sha256/384/512 base64 digest', () => {
    for (const good of ['sha256-ab', 'sha384-abc+/=', 'sha512-AB==', 'sha384-Zz09'])
      expect(ok(pluginRefRecordSchema, { ...ref, integrity: good }), good).toBe(true);
    for (const bad of ['md5-x', 'xsha384-ab', 'sha384-ab===', 'sha384-ab!', 'sha384-', 'sha1-ab', 'sha384-a=b'])
      expect(ok(pluginRefRecordSchema, { ...ref, integrity: bad }), bad).toBe(false);
  });

  it('NFR-SEC-001: trust is trusted or sandboxed', () => {
    for (const trust of ['trusted', 'sandboxed']) expect(ok(pluginRefRecordSchema, { ...ref, trust }), trust).toBe(true);
    for (const trust of ['', 'root', undefined]) expect(ok(pluginRefRecordSchema, { ...ref, trust }), String(trust)).toBe(false);
  });
});
