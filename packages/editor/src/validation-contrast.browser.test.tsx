import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { contrastRatio, LIGHT_THEME } from '@fluxion/theme';
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

const buttons = (name: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === name);
/** The Fix contrast button of the problem whose text contains `about`. */
const fixOf = (about: string) =>
  [...host.querySelectorAll('li.fx-chrome-problem')].find((li) => li.textContent?.includes(about))?.querySelector('button:last-of-type') as HTMLButtonElement;
const items = () => [...host.querySelectorAll('li.fx-chrome-problem')].map((li) => li.textContent ?? '');

/** A document on the light theme with pale text on a pale fill, and a pale outline on an unfilled shape. */
function paleDocument() {
  const b = documentBuilder({ seed: 41 });
  const s = b.screen();
  const label = b.rect(s, { x: 0, y: 0, w: 200, h: 80, label: 'Hello', style: { fill: '#999999', font: { color: '#888888', size: 16 } } });
  const ring = b.rect(s, { x: 300, y: 0, w: 200, h: 80, style: { fill: 'transparent', stroke: { color: '#dbeafe', width: 2 } } });
  const core = createCore(b.build());
  const { name, tokens, defaults, tableStyles } = LIGHT_THEME;
  expect(core.execute('document.setTheme', { theme: { name, tokens, defaults, tableStyles } }).ok).toBe(true);
  return { core, label, ring };
}

describe('contrast in the validation panel (NFR-A11Y-005)', () => {
  it('NFR-A11Y-005: the validation panel offers the contrast fix', () => {
    const { core, label, ring } = paleDocument();
    act(() => root.render(<ProblemsTab store={core.store} session={createSession('doc')} execute={core.execute} />));
    const contrast = items().filter((t) => t.includes('contrast'));
    // one warning for the text, one for the outline, each with its fix
    expect(contrast).toHaveLength(2);
    expect(contrast.find((t) => t.includes(`the text of ${label}`))).toMatch(/Warning:.*\(needs 4\.5:1\).*Fix contrast/);
    expect(contrast.find((t) => t.includes(`the outline of ${ring}`))).toMatch(/\(needs 3:1\).*Fix contrast/);
    expect(buttons('Fix contrast')).toHaveLength(2);
  });

  it('NFR-A11Y-005: applying the fix clears the warning', () => {
    const { core, label, ring } = paleDocument();
    act(() => root.render(<ProblemsTab store={core.store} session={createSession('doc')} execute={core.execute} />));
    act(() => fixOf(`the text of ${label}`).click());
    // the text colour now passes against the fill, and the rest of the style is kept; one undo step
    const style = (core.store.get(label as never) as { style: { fill: string; font: { color: string; size: number } } }).style;
    expect(style.fill).toBe('#999999');
    expect(style.font.size).toBe(16);
    expect(contrastRatio(style.font.color, '#999999')).toBeGreaterThanOrEqual(4.5);
    expect(items().some((t) => t.includes(`the text of ${label}`))).toBe(false);
    const depth = core.store.history.undoDepth;
    act(() => fixOf(`the outline of ${ring}`).click());
    expect(core.store.history.undoDepth).toBe(depth + 1);
    const stroke = (core.store.get(ring as never) as { style: { stroke: { color: string; width: number } } }).style.stroke;
    expect(stroke.width).toBe(2);
    expect(contrastRatio(stroke.color, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(items().filter((t) => t.includes('contrast'))).toEqual([]);
    act(() => core.store.history.undo());
    expect(items().some((t) => t.includes(`the outline of ${ring}`))).toBe(true);
  });
});
