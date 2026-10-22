import { createCoreRegistries, createStore, type ShapeDef } from '@fluxion/core';
import { registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import type { AnyRecord, DocumentFile } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { decompile } from '../decompile/decompile.js';
import { applyPatchCommand } from '../patch/apply.js';
import { buildFor, builtBy } from '../patch/template.js';
import { isTemplate, lowerTemplates } from './lower.js';

const registries = (() => {
  const r = createCoreRegistries();
  for (const id of ['basic:rect', 'basic:rounded-rect', 'basic:block-arrow', 'basic:ellipse', 'basic:triangle', 'basic:trapezoid'])
    r.shapeDefs.register(id, { id, defaultSize: { w: 200, h: 100 } } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  registerBuiltInTemplates(r.templates);
  return r;
})();

const doc = (body: string) => `flux: 1\ntitle: T\nuses: [basic]\nscreens:\n${body}`;
const PROCESS = doc('  - id: flow\n    template: process.basic\n    items: [Plan, Build, Ship]\n');
const run = (text: string) => compile(text, { registries });
const errors = (r: ReturnType<typeof run>) => r.diagnostics.filter((d) => d.severity === 'error');
const records = (d: DocumentFile | undefined): AnyRecord[] => Object.values(d?.records ?? {});
const shapes = (d: DocumentFile | undefined) =>
  records(d).filter((r) => r.type === 'element' && (r as { kind?: string }).kind === 'shape') as unknown as {
    transform: { x: number };
    semantic: { slug: string; template?: { id: string; slot: string; index: number } };
  }[];

describe('a screen with `template:` (FR-LAY-014, ADR-0047)', () => {
  it('FR-LAY-014: WHEN a screen names a template and items THE SYSTEM SHALL build pinned shapes and the connectors between them', () => {
    const r = run(PROCESS);
    expect(errors(r)).toEqual([]);
    const built = shapes(r.doc);
    expect(built.map((s) => s.semantic.slug)).toEqual(['flow-step-0', 'flow-step-1', 'flow-step-2']);
    expect(built.map((s) => s.semantic.template)).toEqual([0, 1, 2].map((index) => ({ id: 'process.basic', slot: 'step', index })));
    expect(built[0]?.transform.x).toBeLessThan(built[1]?.transform.x ?? 0);
    expect(records(r.doc).filter((x) => (x as { kind?: string }).kind === 'connector')).toHaveLength(2);
    const screen = records(r.doc).find((x) => x.type === 'screen') as { layout?: unknown } | undefined;
    expect(screen?.layout).toMatchObject({ type: 'template', id: 'process.basic', items: [{ label: 'Plan' }, { label: 'Build' }, { label: 'Ship' }] });
  });

  it('FR-LAY-014: WHEN the same text is compiled twice THE SYSTEM SHALL give the same document', () => {
    expect(JSON.stringify(run(PROCESS).doc)).toBe(JSON.stringify(run(PROCESS).doc));
  });

  it('FR-LAY-014: WHEN a template screen is decompiled THE SYSTEM SHALL write it back as template, items and options', () => {
    const text = doc(
      '  - id: org\n    template: hierarchy.org\n    items:\n      - label: Product\n        children: [Design, { label: Eng, detail: Platform }]\n    options: { colors: outline }\n',
    );
    const first = run(text);
    expect(errors(first)).toEqual([]);
    const back = decompile(first.doc as DocumentFile, { registries });
    expect(back.text).toContain('template: hierarchy.org');
    expect(back.text).not.toContain('nodes:');
    expect(JSON.stringify(run(back.text).doc)).toBe(JSON.stringify(first.doc));
  });

  it('FR-LAY-014: WHEN the template is unknown THE SYSTEM SHALL say so with the nearest id', () => {
    const r = run(doc('  - id: a\n    template: proces.basic\n    items: [A, B]\n'));
    expect(r.diagnostics.find((d) => d.code === 'FLX_REF_MISSING')).toMatchObject({ hint: 'did you mean "process.basic"?' });
  });

  it("FR-LAY-014: WHEN the items or options are refused THE SYSTEM SHALL report the template's message", () => {
    const few = run(doc('  - id: a\n    template: matrix.2x2\n    items: [A, B]\n'));
    expect(few.diagnostics.find((d) => d.code === 'FLX_SCHEMA_INVALID')?.message).toContain('matrix.2x2 items');
    const odd = run(doc('  - id: a\n    template: process.basic\n    items: [A, B]\n    options: { direction: sideways }\n'));
    expect(odd.diagnostics.find((d) => d.code === 'FLX_SCHEMA_INVALID')?.message).toContain('process.basic options');
    const bad = run(doc('  - id: a\n    template: process.basic\n    items: [A, { detail: x }]\n'));
    expect(bad.diagnostics.map((d) => d.path)).toContain('/screens/0/items');
  });

  it('FR-LAY-014: WHEN a screen has both a layout and a template THE SYSTEM SHALL report it', () => {
    const r = run(doc('  - id: a\n    layout: { type: stack }\n    template: process.basic\n    items: [A, B]\n'));
    expect(r.diagnostics.map((d) => d.message)).toContain('a screen takes a layout or a template, not both');
  });
});

describe('patch setLayout with a template (FR-LAY-014, FR-AI-001)', () => {
  const command = applyPatchCommand(registries);
  const base = () => createStore(compile(doc('  - id: arch\n    nodes:\n      web: { shape: rect }\n'), { registries }).doc as never);
  const patch = (layout: unknown) => ({ flux: 1, ops: [{ op: 'setLayout', scope: 'arch', layout }] });
  const built = (store: ReturnType<typeof base>) =>
    shapes({ records: Object.fromEntries(store.members('byType', 'element').map((id) => [id, store.get(id)])) } as unknown as DocumentFile);

  it('FR-LAY-014: WHEN setLayout names a template THE SYSTEM SHALL build its shapes into the screen, and rebuild them on the next one', () => {
    const store = base();
    const first = command.run({ store }, { patch: patch({ type: 'template', id: 'process.basic', items: ['Plan', 'Build'] }) });
    expect(first).toMatchObject({ ok: true });
    expect(
      built(store)
        .filter((s) => s.semantic.template)
        .map((s) => s.semantic.slug),
    ).toEqual(['arch-step-0', 'arch-step-1']);
    command.run({ store }, { patch: patch({ type: 'template', id: 'process.basic', items: ['A', 'B', 'C'] }) });
    expect(built(store).filter((s) => s.semantic.template)).toHaveLength(3);
    expect(built(store).some((s) => s.semantic.slug === 'web')).toBe(true);
  });

  it('FR-LAY-014: WHEN the template id or items are wrong THE SYSTEM SHALL refuse the patch whole', () => {
    const store = base();
    const unknown = command.run({ store }, { patch: patch({ type: 'template', id: 'funnl', items: ['A', 'B'] }) });
    expect(JSON.stringify(unknown)).toContain('did you mean \\"funnel\\"?');
    const lone = command.run({ store }, { patch: patch({ type: 'template', id: 'funnel', items: ['A'] }) });
    expect(JSON.stringify(lone)).toContain('funnel items');
    expect(built(store).filter((s) => s.semantic.template)).toEqual([]);
  });
});

describe('the pieces of template lowering (FR-LAY-014)', () => {
  const layout = (id: string, items: unknown[]) => ({ type: 'template', id, items }) as never;

  it('FR-LAY-014: WHEN a template is missing, refused or unregistered THE SYSTEM SHALL build nothing for a patch', () => {
    expect(buildFor(undefined, layout('funnel', ['A', 'B']))).toBeUndefined();
    expect(buildFor(registries, layout('nope', ['A', 'B']))).toBeUndefined();
    expect(buildFor(registries, layout('funnel', ['A']))).toBeUndefined();
    const ok = buildFor(registries, layout('funnel', ['A', 'B']));
    expect(ok?.layout).toEqual({ type: 'template', id: 'funnel', items: [{ label: 'A' }, { label: 'B' }] });
  });

  it('FR-LAY-014: WHEN items carry detail, children and options THE SYSTEM SHALL keep them in the layout and the shapes', () => {
    const made = buildFor(registries, {
      type: 'template',
      id: 'venn',
      items: [{ label: 'A', detail: 'one' }, { label: 'B' }],
      options: { opacity: 0.5 },
    } as never);
    expect(made?.layout).toMatchObject({ options: { opacity: 0.5 }, items: [{ label: 'A', detail: 'one' }, { label: 'B' }] });
    expect(made?.built.shapes[0]?.detail).toBe('one');
    expect(made?.built.shapes.map((x) => x.style.opacity)).toEqual([0.5, 0.5]);
    const tree = buildFor(registries, layout('hierarchy.org', [{ label: 'Top', children: [{ label: 'Kid', detail: 'd' }] }]));
    expect(tree?.layout).toMatchObject({ items: [{ label: 'Top', children: [{ label: 'Kid', detail: 'd' }] }] });
  });

  it('FR-LAY-014: WHEN records are searched for what a template built THE SYSTEM SHALL name only those on the screen', () => {
    const records = [
      { id: 'a', screenId: 's', semantic: { template: { id: 't' } } },
      { id: 'b', screenId: 's', semantic: {} },
      { id: 'c', screenId: 'other', semantic: { template: { id: 't' } } },
      { id: 'd', screenId: 's' },
    ];
    expect([...builtBy(records, 's')]).toEqual(['a']);
  });

  it('FR-LAY-014: WHEN the registry value is not a template, or no id is near THE SYSTEM SHALL say the template is missing without a hint', () => {
    expect(isTemplate({})).toBe(false);
    expect(isTemplate(null)).toBe(false);
    const r = run(doc('  - id: a\n    template: zzzzzzzzzz\n    items: [A, B]\n'));
    const missing = r.diagnostics.find((d) => d.code === 'FLX_REF_MISSING');
    expect(missing?.hint).toBeUndefined();
    expect(lowerTemplates({ screens: [] } as never, registries).diagnostics).toEqual([]);
  });

  it('FR-LAY-014: WHEN a template screen gives items a detail THE SYSTEM SHALL build all four quadrants', () => {
    const r = run(doc('  - id: m\n    template: matrix.2x2\n    items:\n      - { label: A, detail: first }\n      - B\n      - C\n      - D\n'));
    expect(errors(r)).toEqual([]);
    expect(shapes(r.doc)).toHaveLength(4);
  });

  it('FR-LAY-014: WHEN every built-in template is patched in THE SYSTEM SHALL build shapes with their parameters and styles', () => {
    const command = applyPatchCommand(registries);
    for (const t of ['process.chevron', 'pyramid', 'cycle.basic', 'timeline.milestones', 'venn', 'funnel']) {
      const store = createStore(compile(doc('  - id: arch\n    nodes:\n      web: { shape: rect }\n'), { registries }).doc as never);
      const r = command.run(
        { store },
        { patch: { flux: 1, ops: [{ op: 'setLayout', scope: 'arch', layout: { type: 'template', id: t, items: ['A', 'B', 'C'] } }] } },
      );
      expect([t, (r as { ok?: boolean }).ok]).toEqual([t, true]);
      const made = store.members('byType', 'element').filter((id) => (store.get(id) as { semantic?: { template?: unknown } }).semantic?.template);
      expect([t, made.length > 0]).toEqual([t, true]);
    }
  });

  it('FR-LAY-014: WHEN a patch template lacks its id or items, or names no near template THE SYSTEM SHALL refuse it with a hint', () => {
    const command = applyPatchCommand(registries);
    const store = createStore(compile(doc('  - id: arch\n    nodes:\n      web: { shape: rect }\n'), { registries }).doc as never);
    const run1 = (layout: unknown) => JSON.stringify(command.run({ store }, { patch: { flux: 1, ops: [{ op: 'setLayout', scope: 'arch', layout }] } }));
    expect(run1({ type: 'template', items: ['A', 'B'] })).toContain('needs an id and items');
    expect(run1({ type: 'template', id: 'funnel' })).toContain('needs an id and items');
    expect(run1({ type: 'template', id: 'qqqqqqqqqqqq', items: ['A', 'B'] })).toContain('see the catalog for template ids');
  });

  it('FR-LAY-014: WHEN a template screen has options and detail items THE SYSTEM SHALL write them back as written', () => {
    const text = doc('  - id: v\n    template: venn\n    items: [A, { label: B, detail: why }]\n    options: { opacity: 0.5 }\n');
    const first = run(text);
    expect(errors(first)).toEqual([]);
    const back = decompile(first.doc as DocumentFile, { registries }).text;
    expect(back).toContain('opacity: 0.5');
    expect(back).toContain('detail: why');
    expect(JSON.stringify(run(back).doc)).toBe(JSON.stringify(first.doc));
  });

  it('FR-LAY-014: WHEN a patch builds a template into a group THE SYSTEM SHALL say a template goes into a screen', () => {
    const command = applyPatchCommand(registries);
    const text = doc(
      '  - id: arch\n    nodes:\n      web: { shape: rect }\n      api: { shape: rect }\n    groups:\n      back: { label: Back, contains: [api] }\n',
    );
    const store = createStore(compile(text, { registries }).doc as never);
    const r = command.run(
      { store },
      { patch: { flux: 1, ops: [{ op: 'setLayout', scope: 'back', layout: { type: 'template', id: 'funnel', items: ['A', 'B'] } }] } },
    );
    expect(JSON.stringify(r)).toContain('a template is built into a screen, not a group');
  });

  it('FR-LAY-014: WHEN a read screen names a template without an id or without items THE SYSTEM SHALL leave it or refuse its items', () => {
    const at = { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } };
    const screen = (layout: unknown) => ({ id: { value: 's', range: at }, nodes: [], groups: [], edges: [], range: at, layout });
    const noId = { screens: [screen({ type: { value: 'template', range: at } })] } as never;
    expect(lowerTemplates(noId, registries)).toEqual({ ast: noId, diagnostics: [] });
    const noItems = { screens: [screen({ type: { value: 'template', range: at }, id: { value: 'funnel', range: at } })] } as never;
    expect(lowerTemplates(noItems, registries).diagnostics.map((d) => d.code)).toEqual(['FLX_SCHEMA_INVALID']);
  });

  it('FR-LAY-014: WHEN items are missing or not a list, or options are not a map THE SYSTEM SHALL report items, and ignore the options', () => {
    const none = run(doc('  - id: a\n    template: funnel\n'));
    expect(none.diagnostics.some((d) => d.code === 'FLX_SCHEMA_INVALID')).toBe(true);
    const scalar = run(doc('  - id: a\n    template: funnel\n    items: x\n'));
    expect(scalar.diagnostics.map((d) => d.path)).toContain('/screens/0/items');
    const listed = run(doc('  - id: a\n    template: funnel\n    items: [A, B]\n    options: [1]\n'));
    expect(errors(listed)).toEqual([]);
    const kids = run(doc('  - id: a\n    template: hierarchy.org\n    items: [{ label: A, children: oops }]\n'));
    expect(errors(kids)).toEqual([]);
  });

  it('FR-LAY-014: WHEN two screens use one template THE SYSTEM SHALL give each its own nodes, and a patch on one leave the other', () => {
    const two = doc('  - id: a\n    template: process.basic\n    items: [A, B]\n  - id: b\n    nodes:\n      step-0: { shape: rect }\n');
    const r = run(two);
    expect(errors(r)).toEqual([]);
    const both = run(`${two}  - id: c\n    template: process.basic\n    items: [C, D]\n`);
    expect(errors(both)).toEqual([]);
    const store = createStore(r.doc as never);
    const ok = applyPatchCommand(registries).run(
      { store },
      { patch: { flux: 1, ops: [{ op: 'setLayout', scope: 'b', layout: { type: 'template', id: 'process.basic', items: ['X', 'Y', 'Z'] } }] } },
    );
    expect(JSON.stringify(ok)).toContain('"ok":true');
    const els = store.members('byType', 'element').map((id) => store.get(id) as { screenId: string; semantic?: { slug?: string } });
    // the slugs on the screen that holds `slug`
    const slugsWith = (slug: string) => {
      const screenId = els.find((e) => e.semantic?.slug === slug)?.screenId;
      return els.filter((e) => e.screenId === screenId).map((e) => e.semantic?.slug);
    };
    expect(slugsWith('a-step-0')).toEqual(['a-step-0', 'a-step-1', undefined]);
    expect(slugsWith('step-0')).toEqual(expect.arrayContaining(['step-0', 'b-step-0', 'b-step-1', 'b-step-2']));
  });

  it('FR-LAY-014: WHEN the author draws an edge to a built node THE SYSTEM SHALL keep it through a decompile', () => {
    const text = doc(
      '  - id: f\n    template: process.basic\n    items: [A, B]\n    nodes:\n      web: { shape: rect }\n    edges:\n      - web -> f-step-0\n',
    );
    const first = run(text);
    expect(errors(first)).toEqual([]);
    const back = decompile(first.doc as DocumentFile, { registries }).text;
    expect(back).toContain('web -> f-step-0');
    expect(JSON.stringify(run(back).doc)).toBe(JSON.stringify(first.doc));
  });
});
