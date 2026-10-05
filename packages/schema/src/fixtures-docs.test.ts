import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './serialize.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the shared fixtures at the repo root, written by scripts/fixtures/gen.mjs (M2.18)
const FIXTURES = import.meta.glob('../../../fixtures/docs/*.flux.json', { query: '?raw', import: 'default', eager: true });
const entries = Object.entries(FIXTURES).map(([path, text]) => [path.split('/').at(-1) ?? path, text] as const);

/** A valid fixture: parses with no error and is already canonical. */
function expectValid(name: string, text: string): void {
  const r = parseDocument(text);
  expect(r.ok ? r.value.diagnostics.filter((d) => d.severity === 'error') : r.error.diagnostics, name).toEqual([]);
  if (r.ok) expect(serializeDocument(r.value.document), name).toBe(text);
}

/** An `invalid-<code>` fixture: fails validation with FLX_<CODE>. */
function expectInvalid(name: string, text: string, code: string): void {
  const r = parseDocument(text);
  expect(r.ok, name).toBe(false);
  const codes = r.ok ? [] : r.error.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
  expect(codes, name).toContain(`FLX_${code.toUpperCase().replaceAll('-', '_')}`);
}

/** The most a fixture may weigh: a benchmark (perf-*) is as large as what it measures (500 elements take ~210 KB), the 20-screen size fixture takes ~125 KB and the 50-screen open-time fixture ~305 KB. */
const maxKiB = (name: string): number => (name.startsWith('perf-') ? 256 : name === 'doc20.flux.json' ? 160 : name === 'doc50.flux.json' ? 340 : 50);

describe('shared document fixtures (FR-DOC-001)', () => {
  it('FR-DOC-001: fixtures/docs behave as named', () => {
    expect(entries.map(([name]) => name).sort()).toEqual([
      'doc20.flux.json',
      'doc50.flux.json',
      'invalid-ref-missing.flux.json',
      'invalid-schema-invalid.flux.json',
      'minimal.flux.json',
      'perf-500.flux.json',
      'rich-text.flux.json',
      'shapes-gallery.flux.json',
      'two-rects-line.flux.json',
      'unknown-kind.flux.json',
    ]);
    for (const [name, text] of entries) {
      expect(text.length, name).toBeLessThanOrEqual(maxKiB(name) * 1024);
      const code = /^invalid-(.+)\.flux\.json$/.exec(name)?.[1];
      if (code === undefined) expectValid(name, text);
      else expectInvalid(name, text, code);
    }
  });

  // M2 final F7: a valid fixture behaves as named too, not only "valid"
  it('FR-DOC-005: the unknown-kind fixture parses with FLX_KIND_UNKNOWN', () => {
    const text = entries.find(([name]) => name === 'unknown-kind.flux.json')?.[1];
    expect(text).toBeDefined();
    const r = parseDocument(text ?? '');
    expect(r.ok).toBe(true);
    const warnings = r.ok ? r.value.diagnostics.filter((d) => d.code === 'FLX_KIND_UNKNOWN') : [];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((d) => d.severity === 'warning')).toBe(true);
  });
});
