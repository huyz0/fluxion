// FR-CON-008: a connector does not hop over one that a build hides on the screen being shown (ScreenView's `hidden`, which the player passes).
import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScreenView } from './screen-view.js';
import { testRegistries } from './test-registries.js';

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

/** A horizontal connector, then a vertical one painted after it crossing it at (100, 100), with line jumps on. */
function crossing() {
  const b = documentBuilder({ seed: 1621 });
  const screen = b.screen({ size: { w: 400, h: 300 } });
  const horizontal = b.connect({ x: 0, y: 100 }, { x: 200, y: 100 }, { arrow: false });
  b.connect({ x: 100, y: 0 }, { x: 100, y: 200 }, { arrow: false });
  const file = b.build();
  const records = { ...file.records } as Record<string, { readonly type?: unknown; readonly settings?: object }>;
  const [id, doc] = Object.entries(records).find(([, r]) => r.type === 'document') as [string, { readonly settings?: object }];
  records[id] = { ...doc, settings: { ...doc.settings, lineJumps: true } };
  return { file: { ...file, records } as DocumentFile, horizontal, screen };
}

describe('line jumps under builds (FR-CON-008)', () => {
  it('FR-CON-008: a connector does not hop over one a build hides on the screen being shown', () => {
    const { file, horizontal, screen } = crossing();
    const { store } = createCore(file);
    const registries = testRegistries();
    const strokes = (hidden: ReadonlySet<RecordId> | undefined): string[] => {
      act(() =>
        root.render(
          <ScreenView
            store={store}
            screenId={screen}
            mode="present"
            view={{ kind: 'fit', box: { w: 400, h: 300 } }}
            registries={registries}
            {...(hidden === undefined ? {} : { hidden })}
          />,
        ),
      );
      return [...host.querySelectorAll('path.fx-route')].map((p) => p.getAttribute('d') ?? '');
    };
    expect(strokes(undefined)[1]).toMatch(/^M100 0 L100 94 C/);
    // the horizontal connector is not drawn yet, so the vertical one runs straight
    expect(strokes(new Set([horizontal]))).toEqual(['M100 0 L100 200']);
  });
});
