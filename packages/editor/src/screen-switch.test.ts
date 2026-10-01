import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { screenLabel, shownScreen } from './screen-switch.js';

describe('which screen is shown (FR-EDT-006)', () => {
  it('FR-EDT-006: the wanted screen if the document has it, else the first; hidden screens count', () => {
    const b = documentBuilder({ seed: 7 });
    const first = b.screen({ size: { w: 100, h: 100 } });
    const second = b.screen({ size: { w: 100, h: 100 } });
    const { store } = createCore(b.build());
    store.transact('hide', (tx) => tx.patch(first, { hidden: true }));
    expect([shownScreen(store, second), shownScreen(store, first)]).toEqual([second, first]);
    // nothing wanted, or something that is not a screen of this document: the first
    expect([shownScreen(store, undefined), shownScreen(store, 'gone' as never)]).toEqual([first, first]);
    // a record that is not a screen is not one to show
    const rect = documentBuilder({ seed: 8 });
    const s = rect.screen({ size: { w: 10, h: 10 } });
    const r = rect.rect(s, { x: 0, y: 0, w: 5, h: 5 });
    expect(shownScreen(createCore(rect.build()).store, r)).toBe(s);
  });

  it('FR-EDT-006: a document without screens shows none', () => {
    const { store } = createCore(documentBuilder({ seed: 9 }).build());
    expect(shownScreen(store, undefined)).toBeUndefined();
  });

  it('FR-EDT-006: a screen is listed by its name, or by its position when it has none or a blank one', () => {
    expect([screenLabel('Pricing', 4), screenLabel(undefined, 0), screenLabel('', 1), screenLabel('   ', 2), screenLabel(' x ', 3)]).toEqual([
      'Pricing',
      'Screen 1',
      'Screen 2',
      'Screen 3',
      ' x ',
    ]);
  });
});
