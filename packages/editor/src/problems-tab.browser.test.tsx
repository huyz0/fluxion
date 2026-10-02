import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProblemsTab } from './problems-tab.js';
import { createSession } from './session.js';

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

const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name);

describe('the Problems tab (FR-EDT-021)', () => {
  it('FR-EDT-021: a binding to a missing element is listed and Free the end runs the command and clears the problem', () => {
    const b = documentBuilder({ seed: 91 });
    const s = b.screen();
    const a = b.rect(s, { x: 0, y: 0, w: 100, h: 50 });
    const c = b.rect(s, { x: 300, y: 0, w: 100, h: 50 });
    b.connect(a, c);
    const built = b.build();
    // the element is gone but its binding is left: what no command can do, so only a loaded or foreign document has it
    const { [c]: _gone, ...records } = built.records;
    const core = createCore({ ...built, records });
    const executed: string[] = [];
    const execute: Parameters<typeof ProblemsTab>[0]['execute'] = (id, args, options) => {
      executed.push(id);
      return core.execute(id, args, options);
    };
    act(() => root.render(<ProblemsTab store={core.store} session={createSession('doc')} execute={execute} />));
    expect(host.querySelector('ul[aria-label="Problems"]')?.textContent).toContain(c);
    act(() => button('Free the end')?.click());
    expect(executed).toEqual(['connector.freeEnd']);
    expect(host.textContent).toContain('No problems found.');
  });
});
