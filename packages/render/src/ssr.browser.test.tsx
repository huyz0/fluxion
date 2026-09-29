import { createCore } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screenArea } from './fit.js';
import { modePolicy } from './mode-policy.js';
import { screensInOrder } from './screen-order.js';
import { ScreenView } from './screen-view.js';
import { renderDocumentToHtml } from './ssr.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the shared valid fixtures at the repo root (scripts/fixtures/gen.mjs); invalid-* do not load
const FIXTURES = Object.entries(import.meta.glob('../../../fixtures/docs/*.flux.json', { query: '?raw', import: 'default', eager: true }))
  .filter(([path]) => !path.includes('/invalid-'))
  .map(([path, text]) => [path.split('/').at(-1) ?? path, JSON.parse(text) as DocumentFile] as const);

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

/**
 * A screen's markup in a comparable form: every style attribute re-serialized by the browser's CSS
 * parser (React's client writes styles through the DOM, its server writes the authored text), and
 * the per-render ids of useId (gradients, markers) numbered by first appearance.
 */
function comparable(screen: Element): string {
  const copy = screen.cloneNode(true) as Element;
  for (const el of [copy, ...copy.querySelectorAll('*')]) {
    const style = (el as HTMLElement | SVGElement).style;
    if (el.hasAttribute('style')) el.setAttribute('style', style.cssText);
    // attribute order is how each renderer happened to write them, not part of the markup's meaning
    const attributes = [...el.attributes].map((a) => [a.name, a.value] as const).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [attr] of attributes) el.removeAttribute(attr);
    for (const [attr, value] of attributes) el.setAttribute(attr, value);
  }
  const ids = new Map<string, string>();
  return copy.outerHTML.replace(/fx-(fill|marker)-[\w-]+/g, (id) => {
    if (!ids.has(id)) ids.set(id, `fx-id-${ids.size}`);
    return ids.get(id) as string;
  });
}

describe('SSR parity (FR-SCR-001, ADR-0015)', () => {
  it('FR-SCR-001: SSR markup equals the browser render for each fixture', async () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(3);
    let compared = 0;
    for (const [name, file] of FIXTURES) {
      const { store } = createCore(file);
      for (const id of store.query((view) => screensInOrder(view, modePolicy('export').showHidden))()) {
        const parsed = document.createElement('div');
        parsed.innerHTML = /<main class="fx-document">([\s\S]*)<\/main>/.exec(renderDocumentToHtml(file, { screens: [id] }).html)?.[1] ?? '';
        const area = screenArea((store.get(id) ?? {}) as Parameters<typeof screenArea>[0]);
        await act(async () => root.render(<ScreenView store={store} screenId={id} mode="export" view={{ kind: 'fit', box: { w: area.w, h: area.h } }} />));
        const [server, client] = [parsed.querySelector('.fx-screen'), host.querySelector('.fx-screen')];
        expect(server, name).not.toBeNull();
        expect(comparable(server as Element), name).toBe(comparable(client as Element));
        compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(3);
  });
});
