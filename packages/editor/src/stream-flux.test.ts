import { createCore, type ShapeDef } from '@fluxion/core';
import { compile } from '@fluxion/dsl';
import { seededRandom, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { newDocument } from './new-document.js';
import { createSession } from './session.js';
import { streamFluxScript } from './stream-flux.js';

const HEAD = 'flux: 1\ntitle: Streamed\nuses: [basic]\nscreens:\n';
const ONE = '- id: one\n  title: One\n  nodes:\n    a: { shape: rect, label: A }\n    b: { shape: rect, label: B }\n  edges:\n  - a -> b\n';
const TWO = '- id: two\n  title: Two\n  nodes:\n    c: { shape: rect, label: C }\n';
const THREE = '- id: three\n  title: Three\n  nodes:\n    d: { shape: rect, label: D }\n    e: { shape: rect, label: E }\n  edges:\n  - d -> e\n';
const TEXT = HEAD + ONE + TWO + THREE;

function setup() {
  const core = createCore(newDocument(seededRandom(3)));
  core.registries.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  return { ...core, session: createSession('t') };
}
const screensOf = (store: ReturnType<typeof setup>['store']) => store.members('byType', 'screen').length;
const elementsOf = (store: ReturnType<typeof setup>['store']) => store.members('byType', 'element').length;

/** The text in chunks of `size`. */
async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let at = 0; at < text.length; at += size) yield text.slice(at, at + size);
}

describe('streamFluxScript', () => {
  it('FR-AI-010: screens reach the store one at a time as their blocks complete, never half a screen, and the end equals the whole-file compile', async () => {
    const { store, execute, registries, session } = setup();
    const base0 = store.toDocument();
    const seen: { screens: number; elements: number }[] = [];
    async function* source() {
      for await (const chunk of chunksOf(TEXT, 17)) {
        // the store as it was when the stream asked for this chunk: the earlier ones are consumed
        seen.push({ screens: screensOf(store), elements: elementsOf(store) });
        yield chunk;
      }
    }
    const result = await streamFluxScript(source(), { store, execute, registries, session, replace: true });
    expect(result).toMatchObject({ status: 'done', screens: 3, recompiled: false });
    // 1 screen: a, b, edge = 3 elements; 2 screens: + c = 4; 3 screens: + d, e, edge = 7. Only whole screens ever show.
    for (const s of seen) expect(['0:0', '1:0', '1:3', '2:4', '3:7']).toContain(`${s.screens}:${s.elements}`);
    const order = seen.map((s) => s.screens);
    expect([...order].sort()).toEqual(order);
    const whole = compile(TEXT, {
      registries,
      base: { ...base0, records: Object.fromEntries(Object.entries(base0.records).filter(([, r]) => r.type === 'document')) },
    });
    expect(whole.doc).toBeDefined();
    expect(serializeDocument(store.toDocument())).toBe(serializeDocument(whole.doc as never));
  });

  it('FR-AI-010: the canvas follows the first screen that arrives and the whole stream is one undo step', async () => {
    const { store, execute, registries, session } = setup();
    const first = store.members('byType', 'screen')[0];
    await streamFluxScript(chunksOf(TEXT, 40), { store, execute, registries, session, replace: true });
    const shown = session.screen.get();
    expect(shown).toBeDefined();
    expect(shown).not.toBe(first);
    expect(screensOf(store)).toBe(3);
    expect(store.history.undo().ok).toBe(true);
    // the replaced screen is back and none of the stream's remains
    expect(store.members('byType', 'screen')).toEqual([first]);
    expect(store.history.canUndo()).toBe(false);
  });

  it('FR-AI-010: a tail key that changes how screens compile recompiles the file and replaces the provisional diagnostics', async () => {
    const { store, execute, registries } = setup();
    const text = `flux: 1\nuses: [basic]\nscreens:\n${ONE}title: Late\n`;
    const calls: number[] = [];
    const result = await streamFluxScript(chunksOf(text, 11), { store, execute, registries, replace: true, onDiagnostics: (d) => calls.push(d.length) });
    expect(result.recompiled).toBe(true);
    // the header had no title while the screens streamed: that error was shown, and the whole file's diagnostics (with `title:` after) replace it
    expect(calls.some((n) => n > 0)).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(elementsOf(store)).toBe(3);
  });

  it("FR-AI-010: without replace the screens are added after the document's own, and an abort keeps what arrived", async () => {
    const { store, execute, registries } = setup();
    const controller = new AbortController();
    async function* source() {
      for await (const chunk of chunksOf(TEXT, 30)) {
        if (screensOf(store) >= 2) controller.abort();
        yield chunk;
      }
    }
    const result = await streamFluxScript(source(), { store, execute, registries, signal: controller.signal });
    expect(result.status).toBe('aborted');
    // the new document's empty screen, then the stream's
    expect(screensOf(store)).toBe(1 + result.screens);
    expect(result.screens).toBeGreaterThanOrEqual(1);
  });

  it('FR-AI-010: what the user changes mid-stream and the stream does not touch survives, and the streamed screens equal the whole-file compile', async () => {
    const { store, execute, registries } = setup();
    const own = store.members('byType', 'screen')[0] as string;
    const base0 = store.toDocument();
    let edited = false;
    async function* source() {
      for await (const chunk of chunksOf(TEXT, 30)) {
        if (!edited && screensOf(store) >= 2) {
          edited = true;
          // a shape added on the document's own screen, and that screen renamed, while the stream is open
          expect(execute('screen.rename', { id: own, name: 'Mine' }).ok).toBe(true);
          const shape = {
            id: 'UserShape0000001',
            type: 'element',
            kind: 'shape',
            defId: 'basic:rect',
            screenId: own,
            index: 'a0',
            transform: { x: 0, y: 0, w: 10, h: 10 },
          };
          expect(execute('element.create', { element: shape }).ok).toBe(true);
        }
        yield chunk;
      }
    }
    const result = await streamFluxScript(source(), { store, execute, registries });
    expect(result.status).toBe('done');
    expect(edited).toBe(true);
    expect(store.has('UserShape0000001' as never)).toBe(true);
    expect((store.get(own as never) as { name?: string }).name).toBe('Mine');
    const whole = compile(TEXT, { registries, base: base0 }).doc;
    for (const [id, record] of Object.entries(whole?.records ?? {})) {
      if (id !== own) expect(store.get(id as never), id).toEqual(record);
    }
    expect(screensOf(store)).toBe(4);
  });

  it('FR-AI-010: two streams in a row are two undo steps', async () => {
    const { store, execute, registries } = setup();
    await streamFluxScript(chunksOf(TEXT, 50), { store, execute, registries });
    expect(screensOf(store)).toBe(4);
    const second = `flux: 1\ntitle: Again\nuses: [basic]\nscreens:\n${TWO.replace('id: two', 'id: extra')}`;
    await streamFluxScript(chunksOf(second, 50), { store, execute, registries });
    expect(screensOf(store)).toBe(5);
    store.history.undo();
    expect(screensOf(store)).toBe(4);
    store.history.undo();
    expect(screensOf(store)).toBe(1);
  });

  it('FR-AI-010: the same source streamed twice with replace gives the whole-file compile each time, and a regenerate in upsert mode keeps unchanged screens', async () => {
    const { store, execute, registries } = setup();
    const only = (doc: { records: Record<string, { type: string }> }) => doc.records;
    const base = store.toDocument();
    const wholeOf = (text: string, from = base) =>
      compile(text, { registries, base: { ...from, records: Object.fromEntries(Object.entries(from.records).filter(([, r]) => r.type === 'document')) } }).doc;
    for (let round = 0; round < 2; round++) {
      const result = await streamFluxScript(chunksOf(TEXT, 23), { store, execute, registries, replace: true });
      expect(result, `round ${round}`).toMatchObject({ status: 'done', screens: 3 });
      expect(only(store.toDocument()), `round ${round}`).toEqual(only(wholeOf(TEXT) as never));
    }
    // upsert mode: a regenerate with screen two changed and a screen dropped from the text
    const changed = TEXT.replace('label: C', 'label: Changed');
    const before = store.toDocument();
    await streamFluxScript(chunksOf(changed, 23), { store, execute, registries });
    const after = store.toDocument();
    const whole = compile(changed, { registries, base: before }).doc;
    expect(only(after)).toEqual(only(whole as never));
    const unchanged = Object.keys(before.records).filter((id) => JSON.stringify(before.records[id]) === JSON.stringify(after.records[id]));
    expect(unchanged.length).toBeGreaterThan(Object.keys(before.records).length - 3);
  });

  it('FR-AI-010: a recompiling tail streamed twice with replace gives the whole-file compile each time, and a refused write stops the stream with the store as it was', async () => {
    const { store, execute, registries } = setup();
    const text = `flux: 1\nuses: [basic]\nscreens:\n${ONE}${TWO}title: Late\n`;
    const base = store.toDocument();
    const docOnly = { ...base, records: Object.fromEntries(Object.entries(base.records).filter(([, r]) => r.type === 'document')) };
    const whole = compile(text, { registries, base: docOnly }).doc;
    for (let round = 0; round < 2; round++) {
      const result = await streamFluxScript(chunksOf(text, 19), { store, execute, registries, replace: true });
      expect(result, `round ${round}`).toMatchObject({ status: 'done', recompiled: true });
      expect(store.toDocument().records, `round ${round}`).toEqual(whole?.records);
    }
    const before = store.toDocument().records;
    const refusing = (id: string, args: unknown) =>
      id === 'document.applyRecords' ? { ok: false as const, error: { code: 'COMMAND_ARGS' as const, message: 'no', diagnostics: [] } } : execute(id, args);
    const refused = await streamFluxScript(chunksOf(text, 19), { store, execute: refusing, registries, replace: true });
    expect(refused).toMatchObject({ status: 'refused', problem: 'no', screens: 0 });
    expect(store.toDocument().records).toEqual(before);
  });
});
