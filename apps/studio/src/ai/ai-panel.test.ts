import { createCoreRegistries, createStore, type ShapeDef } from '@fluxion/core';
import { compile, type LlmClient } from '@fluxion/dsl';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { askForPatch, jsonOf } from './ask-patch.js';
import { previewPatch } from './patch-preview.js';
import { scopeText } from './scope.js';

const registries = (() => {
  const r = createCoreRegistries();
  for (const id of ['basic:rect', 'basic:rounded-rect']) r.shapeDefs.register(id, { id } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
})();
const SOURCE = `flux: 1
title: Panel
uses: [basic]
screens:
  - id: arch
    nodes:
      web: { shape: rect }
      api: { shape: rect }
    edges:
      - web -> api
`;
const fresh = () => createStore(compile(SOURCE, { registries }).doc as never);
const signal = { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined };
const replying = (text: string): LlmClient => ({
  id: 'test',
  capabilities: { structuredOutput: false, vision: false },
  async *stream() {
    yield { type: 'text', text };
    yield { type: 'done' };
  },
});

describe('the AI panel logic (FR-EDT-014)', () => {
  it('FR-EDT-014: a preview lists what the patch adds and leaves the store untouched', () => {
    const store = fresh();
    const before = JSON.stringify(store.toDocument());
    const screen = store.members('byType', 'screen')[0];
    const preview = previewPatch(
      store,
      registries,
      { flux: 1, ops: [{ op: 'add', screen: `#${screen}`, slug: 'cache', node: { shape: 'rect', label: 'Cache' } }] },
      screen,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.changes.filter((c) => c.kind === 'added').map((c) => c.label)).toContain('Cache');
    expect(preview.boxes.some((b) => b.state === 'added')).toBe(true);
    expect(JSON.stringify(store.toDocument())).toBe(before);
  });

  it('FR-EDT-014: a patch that does not apply gives problems and changes nothing', () => {
    const store = fresh();
    const preview = previewPatch(store, registries, { flux: 1, ops: [{ op: 'remove', target: 'nothing-here' }] }, undefined);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.problems.length).toBeGreaterThan(0);
  });

  it('FR-EDT-014: the reply is read as JSON from a fence or a sentence, and a reply with none is a sentence for the person', async () => {
    expect(jsonOf('Sure:\n```json\n{"flux":1}\n```')).toEqual({ flux: 1 });
    expect(jsonOf('here {"flux":1} done')).toEqual({ flux: 1 });
    expect(jsonOf('no patch')).toBeUndefined();
    const asked = await askForPatch({ client: replying('sorry'), prompt: 'x', scope: '', signal });
    expect(asked).toEqual({ ok: false, problem: 'The model did not reply with a patch.' });
  });

  it('FR-EDT-014: the scope names the screen and its elements by #id, and a selection names only itself', () => {
    const store = fresh();
    const [first, second] = store.members('byType', 'element') as string[];
    expect(scopeText(store, 'screen', undefined, [])).toContain(`#${first}`);
    const only = scopeText(store, 'selection', undefined, [first as string]);
    expect(only).toContain(`#${first}`);
    expect(only).not.toContain(`#${second}`);
  });
});
