import { serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { toMermaid } from './mermaid.js';

/** The subset of the Mermaid flowchart grammar the export may write: a header, node lines and edge lines (the fixture grammar of FR-EXP-007). */
const NODE = /^ {2}n\d+(\[|\(|\(\[|\{|\{\{|\[\(|\[\/)"[^"]*"(\]|\)|\]\)|\}|\}\}|\)\]|\/\])$/;
const EDGE = /^ {2}n\d+ (-->|-->\|"[^"]*"\|) n\d+$/;
const acceptsMermaid = (text: string): boolean => {
  const [header, ...rest] = text.trimEnd().split('\n');
  return header === 'flowchart TD' && rest.every((l) => NODE.test(l) || EDGE.test(l));
};

function diagram() {
  const b = documentBuilder({ seed: 18 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0, w: 100, h: 50, label: 'Start' });
  const d = b.rect(s, { x: 0, y: 100, w: 100, h: 50, label: 'Ok "?"', defId: 'basic:diamond' });
  const z = b.rect(s, { x: 0, y: 200, w: 100, h: 50, label: 'End', defId: 'basic:cylinder' });
  b.connect(a, d);
  b.connect(d, z);
  b.connect(z, { x: 500, y: 500 });
  b.text(s, 'a note', { x: 300, y: 0, w: 50, h: 20 });
  return b.build();
}

describe('toMermaid (FR-EXP-007)', () => {
  it('FR-EXP-007: a diagram screen exports to the golden flowchart the grammar accepts', async () => {
    const r = toMermaid(diagram());
    await expect(r.text).toMatchFileSnapshot('./__golden__/diagram.mmd');
    expect(acceptsMermaid(r.text)).toBe(true);
    expect(r).toMatchObject({ nodes: 3, edges: 2, dropped: 2 });
  });

  it('FR-EXP-007: the export is deterministic and an empty screen is a bare header', () => {
    const doc = diagram();
    expect(toMermaid(doc).text).toBe(toMermaid(JSON.parse(serializeDocument(doc))).text);
    const b = documentBuilder({ seed: 19 });
    b.screen();
    expect(toMermaid(b.build())).toEqual({ text: 'flowchart TD\n', nodes: 0, edges: 0, dropped: 0 });
  });
});
