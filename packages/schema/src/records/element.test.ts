import { describe, expect, it } from 'vitest';
import { bindingRecordSchema } from './binding.js';
import { elementKindSchemas } from './element-schemas.js';

const box = { x: 0, y: 0, w: 100, h: 50 };
const el = { type: 'element', screenId: 's1', index: 'a0' };
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('element kinds', () => {
  it('FR-SHP-001: a shape references a definition and has transform, style, text and semantic data', () => {
    const shape = {
      ...el,
      id: 'e1',
      kind: 'shape',
      defId: 'basic:rounded-rect',
      params: { radius: 8 },
      transform: { ...box, rot: 30 },
      style: { variant: 'emphasis' },
      text: doc('API'),
      semantic: { slug: 'api', label: 'API gateway', tags: ['edge'] },
      anchors: [{ name: 'port', x: 1, y: 0.5, role: 'out' }],
    };
    expect(elementKindSchemas.shape.parse(shape)).toEqual(shape);
  });

  it('FR-SHP-001: a shape without defId fails at defId', () => {
    const r = elementKindSchemas.shape.safeParse({ ...el, id: 'e1', kind: 'shape', transform: box });
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('/'))).toEqual(['defId']);
  });

  it('FR-CON-001: a connector with a bound source and a free target validates', () => {
    const connector = {
      ...el,
      id: 'c1',
      kind: 'connector',
      route: { type: 'orthogonal', cornerRadius: 8 },
      markers: { end: 'arrow' },
      labels: [{ text: doc('calls'), position: 0.5 }],
      freeTarget: { x: 400, y: 300 },
    };
    const binding = { id: 'b1', type: 'binding', connectorId: 'c1', end: 'source', elementId: 'e1', anchor: { kind: 'auto' } };
    expect(elementKindSchemas.connector.parse(connector)).toMatchObject({ freeTarget: { x: 400, y: 300 } });
    expect(bindingRecordSchema.parse(binding)).toEqual(binding);
  });

  it('FR-CON-001: every anchor intent validates and bad ones fail', () => {
    const b = { id: 'b1', type: 'binding', connectorId: 'c1', end: 'target', elementId: 'e2' };
    for (const anchor of [
      { kind: 'auto' },
      { kind: 'floating' },
      { kind: 'named', name: 'n' },
      { kind: 'side', side: 'e' },
      { kind: 'side', side: 'w', t: 0.25 },
      { kind: 'point', x: 0.5, y: 1 },
    ])
      expect(bindingRecordSchema.safeParse({ ...b, anchor }).success, JSON.stringify(anchor)).toBe(true);
    for (const anchor of [{ kind: 'side', side: 'up' }, { kind: 'point', x: 2, y: 0 }, { kind: 'named', name: '' }, { kind: 'magnet' }, {}])
      expect(bindingRecordSchema.safeParse({ ...b, anchor }).success, JSON.stringify(anchor)).toBe(false);
    expect(bindingRecordSchema.safeParse({ ...b, end: 'middle', anchor: { kind: 'auto' } }).success).toBe(false);
  });

  it('FR-DOC-001: group, frame, text, image and component kinds validate', () => {
    expect(elementKindSchemas.group.safeParse({ ...el, id: 'g', kind: 'group', transform: box }).success).toBe(true);
    expect(elementKindSchemas.frame.safeParse({ ...el, id: 'f', kind: 'frame', transform: box, clip: true, padding: 12 }).success).toBe(true);
    expect(elementKindSchemas.text.safeParse({ ...el, id: 't', kind: 'text', transform: box, text: doc('Hi'), autoSize: 'height' }).success).toBe(true);
    const image = elementKindSchemas.image.parse({ ...el, id: 'i', kind: 'image', transform: box, assetId: 'a1', crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    expect(image.fit).toBe('contain');
    expect(
      elementKindSchemas.component.safeParse({ ...el, id: 'k', kind: 'component', transform: box, componentId: 'acme:chart', props: { series: [] } }).success,
    ).toBe(true);
  });

  it('FR-DOC-005: a plugin kind keeps its props verbatim', () => {
    const plugin = { ...el, id: 'p', kind: 'acme:gauge', transform: box, props: { value: 42, nested: { deep: [1, 2] } }, extra: 'kept' };
    expect(elementKindSchemas.plugin.parse(plugin)).toEqual({ ...plugin, transform: { ...box, rot: 0 } });
  });

  it('rejects bad element fields', () => {
    const shape = { ...el, id: 'e1', kind: 'shape', defId: 'basic:rect', transform: box };
    for (const bad of [
      { ...shape, defId: 'rect' },
      { ...shape, screenId: undefined },
      { ...shape, index: '' },
      { ...shape, transform: { x: 0, y: 0, w: -1, h: 1 } },
      { ...shape, semantic: { slug: 'Not A Slug' } },
      { ...shape, placement: 'floating' },
      { ...shape, anchors: [{ name: 'a', x: 1.5, y: 0 }] },
      {
        ...shape,
        text: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] }] }],
        },
      },
    ])
      expect(elementKindSchemas.shape.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(elementKindSchemas.connector.safeParse({ ...el, id: 'c', kind: 'connector', route: { type: 'zigzag' } }).success).toBe(false);
    expect(elementKindSchemas.connector.safeParse({ ...el, id: 'c', kind: 'connector', route: { type: 'straight' }, markers: { end: 'spear' } }).success).toBe(
      false,
    );
    expect(elementKindSchemas.image.safeParse({ ...el, id: 'i', kind: 'image', transform: box }).success).toBe(false);
  });
});
