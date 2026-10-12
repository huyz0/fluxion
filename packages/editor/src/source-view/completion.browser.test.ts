import { completionStatus, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createCore, type ShapeDef } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fluxScriptCompletion } from './completion.js';
import { completionCatalog } from './completion-catalog.js';
import { BASIC_IDS } from './completion-fixture.js';
import { fluxScriptLanguage } from './fluxscript-language.js';

// T1 for FR-DSL-009 (M12.21): completion in a real CodeMirror view, over a catalog built from the editor's registries and store the way the
// source view builds it. The basic pack's shape ids are registered as packs/basic registers them (an editor may not import a pack, ADR-0017).
const SHAPE: Omit<ShapeDef, 'id'> = { outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } };

function setup() {
  const b = documentBuilder({ seed: 212 });
  const screen = b.screen();
  b.rect(screen, { slug: 'api' });
  b.rect(screen, { slug: 'db' });
  const other = b.screen();
  b.rect(other, { slug: 'elsewhere' });
  const core = createCore(b.build());
  for (const id of BASIC_IDS) core.registries.shapeDefs.register(id, { ...SHAPE, id }, 'test');
  const catalog = completionCatalog({ shapeDefs: core.registries.shapeDefs, view: core.store, screen: () => screen });
  return { catalog, ids: BASIC_IDS };
}

let view: EditorView | undefined;
afterEach(() => view?.destroy());

/** A view over `doc` with the cursor at its end, and the labels completion lists once it has run. */
async function labelsAfter(doc: string): Promise<string[]> {
  const { catalog } = setup();
  const parent = document.body.appendChild(document.createElement('div'));
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [fluxScriptLanguage(), fluxScriptCompletion(catalog)] }),
  });
  startCompletion(view);
  const v = view;
  await vi.waitFor(() => expect(completionStatus(v.state)).toBe('active'));
  return currentCompletions(v.state).map((c) => c.label);
}

const NODE = 'flux: 1\nscreens:\n  - id: s\n    nodes:\n      a:\n';

describe('fluxScriptCompletion (FR-DSL-009, ADR-0032)', () => {
  it('FR-DSL-009: after shape: the list holds every registered basic shape and no shape of a pack that is not registered', async () => {
    const labels = await labelsAfter(`${NODE}        shape: `);
    const { ids } = setup();
    expect(ids.length).toBeGreaterThan(0);
    expect(labels.filter((l) => l.startsWith('basic:')).sort()).toEqual([...ids].sort());
    expect(labels.some((l) => l.startsWith('uml:'))).toBe(false);
  });

  it('FR-DSL-009: token names after fill: are the theme tokens, narrowed by the prefix typed', async () => {
    const all = await labelsAfter(`${NODE}        style:\n          fill: `);
    expect(all.length).toBeGreaterThan(3);
    const prefix = (all[0] as string).slice(0, 4);
    view?.destroy();
    const narrowed = await labelsAfter(`${NODE}        style:\n          fill: ${prefix}`);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThanOrEqual(all.length);
    expect(narrowed.every((l) => l.includes(prefix))).toBe(true);
  });

  it('FR-DSL-009: after an edge op the list holds the slugs of the open screen and not those of another', async () => {
    const labels = await labelsAfter('flux: 1\nscreens:\n  - id: s\n    edges:\n      - api -> ');
    expect(labels.sort()).toEqual(['api', 'db']);
  });

  it('FR-DSL-009: after a slug and a dot the list holds the anchors', async () => {
    const labels = await labelsAfter('flux: 1\nscreens:\n  - id: s\n    edges:\n      - api.');
    expect(labels.sort()).toEqual(['e', 'n', 's', 'w']);
  });
});
