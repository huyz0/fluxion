import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { fitBox } from './camera.js';
import { commandMap, dispatchKey, EDITOR_COMMANDS, type EditorCommandCtx } from './editor-commands.js';
import { DEFAULT_KEYMAP, type KeyPress, toolBindings } from './keymap.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry, type ToolCtx, type ToolDispatcher } from './tools.js';

const press = (key: string, o: Partial<KeyPress> = {}): KeyPress => ({ key, shift: false, alt: false, mod: false, ...o });
const area = { x: 0, y: 0, w: 1600, h: 900 };

/** The built-in tools over a context whose writes are logged, and a key dispatcher over them. */
function setup(ctxOf: (tools: ReturnType<typeof createToolDispatcher>) => Partial<EditorCommandCtx> = () => ({}), doc = documentBuilder({ seed: 1 }).build()) {
  const session = createSession('doc');
  const writes: [string, unknown][] = [];
  const ctx: ToolCtx = {
    session,
    hitTest: () => undefined,
    elementsIn: () => [],
    screen: undefined,
    allElements: () => ['one', 'two'] as RecordId[],
    view: createCore(doc).store,
    newId: () => 'new' as RecordId,
    execute: (id, args) => {
      writes.push([id, args]);
      return { ok: true, value: undefined };
    },
    seal: () => {},
  };
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const tools = createToolDispatcher(registry, ctx);
  const keymap = [...DEFAULT_KEYMAP, ...toolBindings(tools.list())];
  const key = (k: KeyPress) => dispatchKey(k, keymap, commandMap(), { mode: 'edit', tools, ...ctxOf(tools) });
  return { session, tools, writes, key };
}

/** A dispatcher whose state takes the keys `takes` says, and otherwise does nothing. */
const keysOnly = (tools: ToolDispatcher, takes: (k: KeyPress) => boolean): ToolDispatcher => ({
  pointer: () => false,
  key: takes,
  cancel: () => {},
  escape: () => true,
  use: () => false,
  current: '',
  list: () => [],
  ctx: tools.ctx,
});

describe('editor commands (FR-EDT-012, FR-EDT-011)', () => {
  it('FR-EDT-011: command ids are unique, titled, and every default binding names a registered command', () => {
    const ids = EDITOR_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EDITOR_COMMANDS.every((c) => c.title.length > 0)).toBe(true);
    expect(DEFAULT_KEYMAP.filter((b) => !commandMap().has(b.command))).toEqual([]);
  });

  it('FR-EDT-004: Delete and Backspace delete the selection in one step and select nothing; with none, the key is not taken', () => {
    const { session, writes, key } = setup();
    expect([key(press('Delete')), key(press('Backspace'))]).toEqual([false, false]);
    session.selection.set(['a', 'b'] as RecordId[]);
    expect(key(press('Delete'))).toBe(true);
    session.selection.set(['c'] as RecordId[]);
    expect(key(press('Backspace'))).toBe(true);
    expect([writes, session.selection.get()]).toEqual([
      [
        ['element.delete', { ids: ['a', 'b'] }],
        ['element.delete', { ids: ['c'] }],
      ],
      [],
    ]);
  });

  it('FR-EDT-005: the selection keys act only while the select tool is idle', () => {
    const { session, tools, writes, key } = setup();
    session.selection.set(['a'] as RecordId[]);
    tools.use('hand');
    expect([key(press('ArrowLeft')), key(press('a', { mod: true })), key(press('Delete'))]).toEqual([false, false, false]);
    tools.use('select');
    expect(key(press('a', { mod: true }))).toBe(true);
    expect([session.selection.get(), writes]).toEqual([['one', 'two'], []]);
  });

  it('FR-EDT-002: the camera commands need a canvas with a size and a screen; the fits fit what there is', () => {
    const viewport = { w: 800, h: 600 };
    const bare = setup();
    expect(bare.key(press('=', { mod: true }))).toBe(false);
    const sized = setup(() => ({ canvas: { viewport, targets: () => ({ screen: area }) } }));
    expect(sized.key(press('!', { code: 'Digit1', shift: true }))).toBe(true);
    expect(sized.session.camera.get()).toEqual(fitBox(area, viewport));
    // no selection: shift + 2 has nothing to fit, and the key is left to the tools
    expect(sized.key(press('@', { code: 'Digit2', shift: true }))).toBe(false);
    const empty = setup(() => ({ canvas: { viewport: { w: 0, h: 0 }, targets: () => ({ screen: area }) } }));
    expect(empty.key(press('0', { code: 'Digit0', mod: true }))).toBe(false);
  });

  it('FR-EDT-006: undo and redo cancel the gesture first; without a history or a mode switch they are not taken', () => {
    const log: string[] = [];
    const history = {
      undo: () => (log.push('undo'), { ok: true, value: 'before' }),
      redo: () => (log.push('redo'), { ok: true, value: 'after' }),
    };
    const { tools, key } = setup(() => ({ history, switchMode: () => log.push('switch'), restoreView: (meta: unknown) => log.push(`view ${String(meta)}`) }));
    tools.use('hand');
    tools.pointer({
      phase: 'down',
      pointerId: 1,
      pointerType: 'mouse',
      screen: { x: 1, y: 1 },
      page: { x: 1, y: 1 },
      button: 0,
      buttons: 1,
      shift: false,
      alt: false,
      mod: false,
      pressure: 0.5,
      coalesced: [],
    });
    expect(tools.current).toBe('hand.panning');
    expect([key(press('z', { mod: true })), tools.current]).toEqual([true, 'hand.idle']);
    tools.pointer({
      phase: 'down',
      pointerId: 1,
      pointerType: 'mouse',
      screen: { x: 1, y: 1 },
      page: { x: 1, y: 1 },
      button: 0,
      buttons: 1,
      shift: false,
      alt: false,
      mod: false,
      pressure: 0.5,
      coalesced: [],
    });
    expect([key(press('y', { mod: true })), tools.current]).toEqual([true, 'hand.idle']);
    expect(key(press('F5'))).toBe(true);
    expect(log).toEqual(['undo', 'view before', 'redo', 'view after', 'switch']);
    const none = setup();
    expect([none.key(press('z', { mod: true })), none.key(press('F5'))]).toEqual([false, false]);
  });

  it('FR-EDT-006: an undo with nothing to undo shows no view, and the key is still the history`s', () => {
    const log: string[] = [];
    const history = { undo: () => ({ ok: false }), redo: () => ({ ok: false, value: 'stale' }) };
    const { key } = setup(() => ({ history, restoreView: (meta: unknown) => log.push(`view ${String(meta)}`) }));
    expect([key(press('z', { mod: true })), key(press('y', { mod: true })), log]).toEqual([true, true, []]);
  });

  it('FR-EDT-012: a tool shortcut yields to the state`s own key; other bindings come first; bad args are declined', () => {
    const { tools, key } = setup();
    tools.use('pen');
    // a letter no state takes switches tools (tools.test: a state that takes its letter keeps it)
    expect(key(press('r'))).toBe(true);
    expect(tools.current).toBe('shape.idle');
    // a state that takes a letter keeps it over the tool bound to that letter
    const taking = keysOnly(tools, (k) => k.key === 'h');
    expect(dispatchKey(press('h'), toolBindings(tools.list()), commandMap(), { mode: 'edit', tools: taking })).toBe(true);
    expect(tools.current).toBe('shape.idle');
    // any other binding comes before the state's own keys
    const log: string[] = [];
    const greedy = keysOnly(tools, () => true);
    const history = { undo: () => (log.push('undo'), { ok: true }), redo: () => (log.push('redo'), { ok: true }) };
    dispatchKey(press('z', { mod: true }), DEFAULT_KEYMAP, commandMap(), { mode: 'edit', tools: greedy, history });
    // presenting, Esc is the mode's, not the tools'
    dispatchKey(press('Escape'), DEFAULT_KEYMAP, commandMap(), { mode: 'present', tools, switchMode: () => log.push('switch') });
    expect(log).toEqual(['undo', 'switch']);
    const commands = commandMap();
    const ctx: EditorCommandCtx = { mode: 'edit', tools };
    expect([
      commands.get('tool.use')?.run(ctx, { id: 7 }),
      commands.get('tool.use')?.run(ctx, undefined),
      commands.get('selection.nudge')?.run(ctx, { dx: '1', dy: 0 }),
      commands.get('selection.nudge')?.run(ctx, undefined),
      commands.get('tool.use')?.run(ctx, { id: 'no-such-tool' }),
    ]).toEqual([false, false, false, false, false]);
  });
  it('FR-TXT-003: Enter and F2 open the one selected element with text, in the select tool`s idle state; Enter on nothing is not taken', () => {
    const b = documentBuilder({ seed: 9 });
    const screen = b.screen();
    const text = b.text(screen, 'hi');
    const { session, tools, key } = setup(() => ({}), b.build());
    expect(key(press('enter'))).toBe(false);
    session.selection.set([text]);
    expect(key(press('enter'))).toBe(true);
    expect(session.editing.get()).toBe(text);
    session.editing.set(undefined);
    expect(key(press('f2'))).toBe(true);
    expect(session.editing.get()).toBe(text);
    // a tool other than select: the key is not the selection's
    session.editing.set(undefined);
    tools.use('shape');
    expect(key(press('enter'))).toBe(false);
    expect(session.editing.get()).toBeUndefined();
  });

  it('FR-ARR-001: Ctrl+G groups and Ctrl+Shift+G ungroups the selection in the select tool`s idle state; Esc leaves an entered group before it cancels anything', () => {
    const b = documentBuilder({ seed: 10 });
    const screen = b.screen();
    const [one, two] = [b.rect(screen), b.rect(screen, { x: 300 })];
    const { session, tools, writes, key } = setup(() => ({}), b.build());
    // nothing selected: not taken
    expect(key(press('g', { mod: true }))).toBe(false);
    session.selection.set([one, two]);
    expect(key(press('g', { mod: true }))).toBe(true);
    expect(writes).toEqual([['element.group', { ids: [one, two], groupId: 'new' }]]);
    expect(session.selection.get()).toEqual(['new']);
    // the stubbed context never makes the group, so there is none to ungroup: refused, nothing written
    expect(key(press('g', { mod: true, shift: true }))).toBe(false);
    expect(writes).toHaveLength(1);
    // Esc with a group entered leaves it; the group is selected; the next Esc is the tool's (always taken)
    session.entered.set('new' as RecordId);
    expect(key(press('escape'))).toBe(true);
    expect(session.entered.get()).toBeUndefined();
    expect(session.selection.get()).toEqual([]);
    // with no group entered Esc is the tool's, and always taken
    expect(key(press('escape'))).toBe(true);
    expect(session.entered.get()).toBeUndefined();
    // another tool: the keys are not the selection's, and Esc does not leave an entered group (it cancels the tool)
    tools.use('shape');
    session.entered.set('new' as RecordId);
    session.selection.set([one, two]);
    expect(key(press('g', { mod: true }))).toBe(false);
    expect(writes).toHaveLength(1);
    expect(key(press('escape'))).toBe(true);
    expect(session.entered.get()).toBe('new');
    expect(session.selection.get()).toEqual([one, two]);
  });
});
