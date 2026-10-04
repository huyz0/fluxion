import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recoverable } from './recovery.js';
import { RecoveryPrompt } from './recovery-prompt.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const item = (id: string, title: string, dropped?: { entries: number; reason: string }): Recoverable => ({
  id,
  recovery: {
    records: { a: { id: 'a', type: 'screen' }, b: { id: 'b', type: 'element' } } as never,
    rev: 3,
    unsaved: true,
    applied: 3,
    ...(dropped === undefined ? {} : { dropped }),
    title,
    updated: '2026-10-04T10:00:00.000Z',
  },
});
const button = (name: string, nth = 0): HTMLButtonElement => {
  const found = [...host.querySelectorAll('button')].filter((b) => b.textContent === name)[nth];
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
};
const render = (items: Recoverable[], on: { recover?: (i: Recoverable) => void; discard?: (i: Recoverable) => void; close?: () => void } = {}) =>
  act(() =>
    root.render(
      <RecoveryPrompt
        items={items}
        onRecover={on.recover ?? (() => undefined)}
        onDiscard={on.discard ?? (() => undefined)}
        onClose={on.close ?? (() => undefined)}
      />,
    ),
  );

describe('the recovery prompt (FR-FIL-007)', () => {
  it('FR-FIL-007: it is titled "Recover unsaved changes" and names each document with what is in it', () => {
    render([item('d1', 'Quarterly review'), item('d2', 'Roadmap')]);
    expect(host.querySelector('dialog')?.getAttribute('aria-label')).toBe('Recover unsaved changes');
    expect(host.textContent).toContain('Quarterly review');
    expect(host.textContent).toContain('Roadmap');
    expect(host.textContent).toContain('1 screen, 2 records, 3 changes since it was saved.');
  });

  it('FR-FIL-007: Recover, Discard and Not now each act on the document in their row', () => {
    const recover = vi.fn();
    const discard = vi.fn();
    const close = vi.fn();
    const items = [item('d1', 'First'), item('d2', 'Second')];
    render(items, { recover, discard, close });
    act(() => button('Recover', 1).click());
    act(() => button('Discard', 0).click());
    act(() => button('Not now').click());
    expect(recover).toHaveBeenCalledWith(items[1]);
    expect(discard).toHaveBeenCalledWith(items[0]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('NFR-REL-001: a journal that was cut short says so', () => {
    render([item('d1', 'Cut', { entries: 2, reason: 'entry 5: torn' })]);
    expect(host.querySelector('[role="note"]')?.textContent).toContain('2 later changes could not be read');
  });
});
