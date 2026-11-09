// FR-DOC-001 / FR-EDT-008: each element kind's fields, keywords and inspector entries are checked
// by name, so a dropped literal, bound, keyword or label changes a verdict here.
import { describe, expect, it } from 'vitest';
import { describeFields } from '../field-meta.js';
import { anchorDefSchema, elementKindSchemas } from './element-schemas.js';

const box = { x: 0, y: 0, w: 10, h: 10 };
const el = { type: 'element', screenId: 's1', index: 'a0', id: 'e1' };
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] };
const valid = {
  shape: { ...el, kind: 'shape', transform: box, defId: 'basic:rect' },
  connector: { ...el, kind: 'connector', route: { type: 'straight' } },
  group: { ...el, kind: 'group', transform: box },
  frame: { ...el, kind: 'frame', transform: box },
  text: { ...el, kind: 'text', transform: box, text: doc },
  image: { ...el, kind: 'image', transform: box, assetId: 'a1' },
  component: { ...el, kind: 'component', transform: box, componentId: 'acme:chart', props: {} },
  plugin: { ...el, kind: 'acme:widget', transform: box },
  unknown: { ...el, kind: 'anything' },
} as const;
type Kind = keyof typeof valid;
const ok = (kind: Kind, patch: Record<string, unknown>) => elementKindSchemas[kind].safeParse({ ...valid[kind], ...patch }).success;
const KINDS = Object.keys(valid) as Kind[];
const BOXED = KINDS.filter((k) => k !== 'connector' && k !== 'unknown');
const NAME_HIDDEN = [
  { path: ['name'], ui: 'text', group: 'Element', order: 1, label: 'Name' },
  { path: ['hidden'], ui: 'toggle', group: 'Element', order: 2, label: 'Hidden' },
];
const own = (kind: Kind) => describeFields(elementKindSchemas[kind]).filter((f) => f.path[0] !== 'style' && f.path[0] !== 'transform');

describe('element kinds, field by field', () => {
  it.each(KINDS)('FR-DOC-001: a minimal %s validates and keeps unknown fields', (kind) => {
    expect(elementKindSchemas[kind].parse({ ...valid[kind], extra: 1 })).toEqual({ ...valid[kind], extra: 1 });
    expect(ok(kind, { type: 'screen' })).toBe(false);
    for (const field of ['id', 'screenId', 'index']) expect(ok(kind, { [field]: undefined }), field).toBe(false);
  });

  it.each(BOXED)('FR-DOC-001: a %s needs a transform', (kind) => {
    expect(ok(kind, { transform: undefined })).toBe(false);
  });

  it('FR-DOC-001: each kind takes only its own kind and its own required fields', () => {
    for (const kind of ['shape', 'connector', 'group', 'frame', 'text', 'image', 'component'] as const) expect(ok(kind, { kind: 'other' }), kind).toBe(false);
    expect(ok('shape', { defId: undefined })).toBe(false);
    expect(ok('connector', { route: undefined })).toBe(false);
    expect(ok('text', { text: undefined })).toBe(false);
    expect(ok('image', { assetId: undefined })).toBe(false);
    expect(ok('component', { componentId: undefined })).toBe(false);
    expect(ok('component', { props: undefined })).toBe(false);
    expect(ok('plugin', { kind: 'widget' })).toBe(false);
    expect(ok('plugin', { props: { a: 1 } })).toBe(true);
    expect(ok('plugin', { props: 1 })).toBe(false);
    expect(ok('shape', { params: 1 })).toBe(false);
    expect(ok('unknown', { kind: '' })).toBe(false);
  });

  it.each(KINDS.filter((k) => k !== 'unknown'))('FR-EDT-008: the %s inspector shows its own fields after name and hidden', (kind) => {
    const extra: Partial<Record<Kind, unknown[]>> = {
      shape: [
        { path: ['textFit', 'mode'], ui: 'select', group: 'Text', order: 10, label: 'Fit', options: ['none', 'shrink', 'grow'] },
        { path: ['textFit', 'padding'], ui: 'number', group: 'Text', order: 11, label: 'Padding', min: 0 },
      ],
      connector: [
        { path: ['route', 'type'], ui: 'select', group: 'Route', order: 1, label: 'Route', options: ['straight', 'curved', 'orthogonal', 'polyline'] },
      ],
      frame: [
        { path: ['clip'], ui: 'toggle', group: 'Frame', order: 1, label: 'Clip contents' },
        { path: ['padding'], ui: 'number', group: 'Frame', order: 2, label: 'Padding', min: 0 },
      ],
      text: [{ path: ['autoSize'], ui: 'select', group: 'Text', order: 12, label: 'Auto size', options: ['none', 'width', 'height'] }],
      image: [{ path: ['fit'], ui: 'select', group: 'Image', order: 1, label: 'Fit', options: ['cover', 'contain', 'fill'] }],
    };
    expect(own(kind)).toEqual([...NAME_HIDDEN, ...(extra[kind] ?? [])]);
  });

  it('FR-DOC-001: the common fields are checked: slug, matchKey, placement, locks, semantic', () => {
    for (const slug of ['a', 'a-1', '0x']) expect(ok('group', { semantic: { slug } }), slug).toBe(true);
    for (const slug of ['A', 'xA', 'a!', '-a', '']) expect(ok('group', { semantic: { slug } }), slug).toBe(false);
    expect(ok('group', { semantic: { label: 'l', role: 'r', tags: ['t'], extra: 1 } })).toBe(true);
    for (const bad of [{ label: 1 }, { role: 1 }, { tags: [1] }]) expect(ok('group', { semantic: bad }), JSON.stringify(bad)).toBe(false);
    for (const key of ['position', 'size', 'rotation', 'delete', 'edit']) {
      expect(ok('group', { locks: { [key]: true } }), key).toBe(true);
      expect(ok('group', { locks: { [key]: 'yes' } }), key).toBe(false);
    }
    expect(ok('group', { matchKey: 'k' })).toBe(true);
    expect(ok('group', { matchKey: '' })).toBe(false);
    for (const placement of ['auto', 'pinned']) expect(ok('group', { placement }), placement).toBe(true);
    for (const placement of ['', 'free']) expect(ok('group', { placement }), placement).toBe(false);
    expect(ok('group', { name: 1 })).toBe(false);
    expect(ok('group', { hidden: 'no' })).toBe(false);
  });

  it('FR-CON-001: an anchor is checked field by field, and a fixed or side anchor needs its position', () => {
    const anchor = (a: Record<string, unknown>) => anchorDefSchema.safeParse(a);
    expect(anchor({ name: 'p', x: 0, y: 1 }).success).toBe(true);
    expect(anchor({ name: '', x: 0, y: 1 }).success).toBe(false);
    for (const kind of ['perimeter', 'center']) expect(anchor({ name: 'p', kind }).success, kind).toBe(true);
    expect(anchor({ name: 'p', kind: 'fixed', x: 0.5, y: 0.5 }).success).toBe(true);
    expect(anchor({ name: 'p', kind: 'other' }).success).toBe(false);
    expect(anchor({ name: 'p', kind: '' }).success).toBe(false);
    for (const side of ['n', 'e', 's', 'w']) expect(anchor({ name: 'p', kind: 'side', side }).success, side).toBe(true);
    expect(anchor({ name: 'p', kind: 'side', side: 'x' }).success).toBe(false);
    expect(anchor({ name: 'p', kind: 'side' }).error?.issues.map((i) => [i.path, i.message])).toEqual([[['side'], 'a side anchor needs side']]);
    expect(anchor({ name: 'p', kind: 'perimeter', t: 0.5 }).success).toBe(true);
    for (const role of ['in', 'out', 'any']) expect(anchor({ name: 'p', kind: 'center', role }).success, role).toBe(true);
    expect(anchor({ name: 'p', kind: 'center', role: 'both' }).success).toBe(false);
    expect(anchor({ name: 'p', kind: 'center', max: 1 }).success).toBe(true);
    for (const max of [0, 1.5]) expect(anchor({ name: 'p', kind: 'center', max }).success, String(max)).toBe(false);
    expect(anchor({ name: 'p', kind: 'center', dir: { x: 1, y: 0 } }).success).toBe(true);
    for (const v of [-0.1, 1.1]) {
      expect(anchor({ name: 'p', x: v, y: 0 }).success, `x ${v}`).toBe(false);
      expect(anchor({ name: 'p', x: 0, y: v }).success, `y ${v}`).toBe(false);
      expect(anchor({ name: 'p', kind: 'perimeter', t: v }).success, `t ${v}`).toBe(false);
    }
    expect(anchor({ name: 'p', y: 0 }).error?.issues.map((i) => [i.path, i.message])).toEqual([[['x'], 'a fixed anchor needs x']]);
    expect(anchor({ name: 'p', kind: 'fixed', x: 0 }).error?.issues.map((i) => [i.path, i.message])).toEqual([[['y'], 'a fixed anchor needs y']]);
    expect(ok('shape', { anchors: [{ name: 'p', kind: 'center' }] })).toBe(true);
    expect(ok('shape', { anchors: [{ name: '' }] })).toBe(false);
  });

  it('FR-SHP-006: text fit takes its keywords and bounds', () => {
    for (const mode of ['none', 'shrink', 'grow']) expect(ok('shape', { textFit: { mode } }), mode).toBe(true);
    for (const overflow of ['visible', 'clip']) expect(ok('shape', { textFit: { overflow } }), overflow).toBe(true);
    for (const bad of [{ mode: '' }, { mode: 'fit' }, { overflow: '' }, { overflow: 'hidden' }, { padding: -1 }, { minSize: 0 }])
      expect(ok('shape', { textFit: bad }), JSON.stringify(bad)).toBe(false);
    expect(ok('shape', { textFit: { padding: 0, minSize: 1 } })).toBe(true);
  });

  it('FR-CON-001: a connector route is checked', () => {
    for (const type of ['straight', 'curved', 'orthogonal', 'polyline', 'acme:arc']) expect(ok('connector', { route: { type } }), type).toBe(true);
    for (const type of ['', 'zigzag']) expect(ok('connector', { route: { type } }), type).toBe(false);
    for (const jumps of ['arc', 'gap', 'none']) expect(ok('connector', { route: { type: 'straight', jumps } }), jumps).toBe(true);
    expect(ok('connector', { route: { type: 'straight', jumps: '' } })).toBe(false);
    expect(ok('connector', { route: { type: 'straight', cornerRadius: 0, waypoints: [{ x: 1, y: 2 }] } })).toBe(true);
    expect(ok('connector', { route: { type: 'straight', cornerRadius: -1 } })).toBe(false);
    expect(ok('connector', { route: { type: 'straight', waypoints: [{ x: 1 }] } })).toBe(false);
    for (const key of ['0', '1', '12']) expect(ok('connector', { route: { type: 'straight', tangents: { [key]: { x: 0, y: 1 } } } }), key).toBe(true);
    for (const key of ['01', 'a', '-1', '1a', 'a1'])
      expect(ok('connector', { route: { type: 'straight', tangents: { [key]: { x: 0, y: 1 } } } }), key).toBe(false);
  });

  it('FR-CON-001: connector markers, labels and free ends are checked', () => {
    for (const marker of ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar', 'acme:hook'])
      for (const end of ['start', 'end', 'mid']) expect(ok('connector', { markers: { [end]: marker } }), `${end} ${marker}`).toBe(true);
    for (const end of ['start', 'end', 'mid']) {
      expect(ok('connector', { markers: { [end]: 'hook' } }), end).toBe(false);
      expect(ok('connector', { markers: { [end]: '' } }), end).toBe(false);
    }
    expect(ok('connector', { labels: [{ text: doc, position: 0.5, offset: { x: 1, y: 1 } }] })).toBe(true);
    for (const position of [-0.1, 1.1]) expect(ok('connector', { labels: [{ text: doc, position }] }), String(position)).toBe(false);
    expect(ok('connector', { labels: [{ position: 0.5 }] })).toBe(false);
    expect(ok('connector', { freeSource: { x: 0, y: 0 }, freeTarget: { x: 1, y: 1 } })).toBe(true);
    expect(ok('connector', { freeSource: { x: 0 } })).toBe(false);
    expect(ok('connector', { freeTarget: { y: 0 } })).toBe(false);
  });

  it('FR-DOC-001: frame, text and image fields take their keywords and bounds', () => {
    expect(ok('frame', { clip: true, padding: 0 })).toBe(true);
    expect(ok('frame', { clip: 'yes' })).toBe(false);
    expect(ok('frame', { padding: -1 })).toBe(false);
    for (const autoSize of ['none', 'width', 'height']) expect(ok('text', { autoSize }), autoSize).toBe(true);
    for (const autoSize of ['', 'both']) expect(ok('text', { autoSize }), autoSize).toBe(false);
    for (const fit of ['cover', 'contain', 'fill']) expect(ok('image', { fit }), fit).toBe(true);
    for (const fit of ['', 'stretch']) expect(ok('image', { fit }), fit).toBe(false);
    expect(ok('image', { crop: { x: 0, y: 0, w: 1, h: 1 }, maskDefId: 'basic:circle' })).toBe(true);
    for (const key of ['x', 'y', 'w', 'h']) {
      expect(ok('image', { crop: { x: 0, y: 0, w: 1, h: 1, [key]: 1.1 } }), key).toBe(false);
      expect(ok('image', { crop: { x: 0, y: 0, w: 1, h: 1, [key]: undefined } }), key).toBe(false);
    }
    expect(ok('image', { maskDefId: 'circle' })).toBe(false);
    expect(ok('component', { snapshotAssetId: 'a2' })).toBe(true);
    expect(ok('group', { layout: 1 })).toBe(false);
    expect(ok('frame', { layout: 1 })).toBe(false);
  });
});
