// FR-DOC-004 / FR-AI-004: every diagnostic code carries the severity its reference row documents,
// so a code's severity cannot change (or be lost) without the reference changing with it.
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_CODES, diagnostic, jsonPointer } from './diagnostics.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const reference = Object.values(import.meta.glob('../../../docs/reference/diagnostics.md', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const documented = new Map([...reference.matchAll(/^\| `(FLX_[A-Z_]+)` \| (error|warning|info) \|/gm)].map((m) => [m[1] as string, m[2] as string]));

describe('diagnostic codes and their severities', () => {
  it('FR-DOC-004: the reference documents every code, and nothing else', () => {
    expect(documented.size).toBeGreaterThan(0);
    expect([...documented.keys()].sort()).toEqual(Object.keys(DIAGNOSTIC_CODES).sort());
  });

  it.each(Object.keys(DIAGNOSTIC_CODES))('FR-DOC-004: %s has the documented severity', (code) => {
    expect(DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES]).toBe(documented.get(code));
  });

  it('FR-DOC-004: a JSON pointer escapes ~ and / in each segment', () => {
    expect(jsonPointer([])).toBe('');
    expect(jsonPointer(['records', 'e1', 0])).toBe('/records/e1/0');
    expect(jsonPointer(['a/b', 'c~d', '~/'])).toBe('/a~1b/c~0d/~0~1');
    expect(jsonPointer(['a//b~~'])).toBe('/a~1~1b~0~0');
  });

  it('FR-AI-004: a diagnostic carries its code severity, and a hint only when given one', () => {
    expect(diagnostic('FLX_VERSION_NEWER', ['version'], 'm')).toStrictEqual({ code: 'FLX_VERSION_NEWER', severity: 'warning', path: '/version', message: 'm' });
    expect(diagnostic('FLX_JSON_INVALID', [], 'm', 'h')).toStrictEqual({ code: 'FLX_JSON_INVALID', severity: 'error', path: '', message: 'm', hint: 'h' });
    expect(diagnostic('FLX_JSON_INVALID', [], 'm', '')).toStrictEqual({ code: 'FLX_JSON_INVALID', severity: 'error', path: '', message: 'm', hint: '' });
  });
});
