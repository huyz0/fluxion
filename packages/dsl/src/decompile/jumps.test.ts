// ADR-0169: FluxScript's `lineJumps` (top level) and an edge's `jumps` compile to the document's `settings.lineJumps` and the connector's
// `route.jumps`, a value of the wrong kind is FLX_SCHEMA_INVALID, and decompiling writes both back so the round trip holds.
import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { fluxScriptKeys } from '../read/fields.js';
import { decompile } from './decompile.js';
import { registries } from './registries.fixture.js';

const source = (head: string, edges: string) =>
  `flux: 1\ntitle: Hops\nuses: [basic]\n${head}screens:\n  - id: a\n    nodes:\n      x: { shape: rect, label: X }\n      y: { shape: rect, label: Y }\n    edges:\n${edges}`;
const run = (text: string) => compile(text, { registries: registries() });
type Rec = {
  readonly type?: string;
  readonly kind?: string;
  readonly route?: { readonly jumps?: string };
  readonly settings?: { readonly lineJumps?: boolean };
};
const records = (doc: DocumentFile | undefined) => Object.values(doc?.records ?? {}) as Rec[];

describe('FluxScript line jumps (ADR-0169)', () => {
  it('FR-DSL-001: lineJumps sets the document setting and an edge jumps its route style, in both edge forms', () => {
    const r = run(source('lineJumps: true\n', '      - x -> y: { label: hop, jumps: gap }\n      - { from: y, to: x, jumps: none }\n'));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(records(r.doc).find((d) => d.type === 'document')?.settings).toEqual({ lineJumps: true });
    expect(
      records(r.doc)
        .filter((e) => e.kind === 'connector')
        .map((e) => e.route?.jumps)
        .sort(),
    ).toEqual(['gap', 'none']);
    expect(fluxScriptKeys().top.compiled).toContain('lineJumps');
    expect(fluxScriptKeys().edge.compiled).toContain('jumps');
  });

  it('FR-DSL-001: without the keys the document has no settings and a route no jumps', () => {
    const r = run(source('', '      - x -> y\n'));
    expect(records(r.doc).find((d) => d.type === 'document')?.settings).toBeUndefined();
    expect(records(r.doc).find((e) => e.kind === 'connector')?.route).toEqual({ type: 'straight' });
  });

  it('FR-DSL-001: a jump style that is not arc, gap or none, and a lineJumps that is not a boolean, are FLX_SCHEMA_INVALID with a hint', () => {
    const r = run(source('lineJumps: sometimes\n', '      - x -> y: { jumps: bridge }\n'));
    const invalid = r.diagnostics.filter((d) => d.code === 'FLX_SCHEMA_INVALID');
    expect(invalid.map((d) => d.path).sort()).toEqual(['/lineJumps', '/screens/0/edges/0/jumps']);
    expect(invalid.find((d) => d.path.endsWith('/jumps'))?.hint).toBe('one of arc, gap, none');
  });

  it('FR-DSL-002: decompiling writes lineJumps and each edge jumps back, and the text compiles to the same document', () => {
    const first = run(source('lineJumps: false\n', '      - x -> y: { route: curved, jumps: arc }\n')).doc as DocumentFile;
    const { text, kept } = decompile(first, { registries: registries() });
    expect(kept).toBe(0);
    expect(text).toContain('lineJumps: false\n');
    expect(text).toContain('x -> y: { route: curved, jumps: arc }');
    expect(serializeDocument(run(text).doc as DocumentFile)).toBe(serializeDocument(first));
  });
});
