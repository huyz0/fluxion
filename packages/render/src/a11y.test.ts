import { createCore } from '@fluxion/core';
import type { ConnectorElement, DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { connectorText } from './a11y.js';

describe('a connector’s words in a live document (NFR-A11Y-002, FR-RTE-002)', () => {
  it('NFR-A11Y-002: a rename of a bound shape changes the words, and moving it does not redo them (M18.131)', () => {
    const b = documentBuilder({ seed: 812 });
    const screen = b.screen({ size: { w: 800, h: 600 } });
    const api = b.text(screen, 'API', { x: 10, y: 10, w: 100, h: 50 });
    const db = b.text(screen, 'Orders', { x: 300, y: 10, w: 100, h: 50 });
    const line = b.connect(api, db);
    const { store } = createCore(b.build() as DocumentFile);
    const connector = store.get(line) as ConnectorElement;
    let runs = 0;
    const words = store.query((view) => {
      runs += 1;
      return connectorText(connector, view);
    });
    expect(words()).toBe('API connects to Orders');
    expect(runs).toBe(1);
    // a move is not a rename: the words are not worked out again
    for (const x of [20, 30, 40]) store.transact('move', (tx) => tx.patch(api, { transform: { ...(store.get(api) as { transform: object }).transform, x } }));
    expect(words()).toBe('API connects to Orders');
    expect(runs).toBe(1);
    store.transact('rename', (tx) => tx.patch(api, { semantic: { label: 'Gateway' } }));
    expect(words()).toBe('Gateway connects to Orders');
    expect(runs).toBe(2);
    // the bound shape deleted (its binding too): the end is free
    store.transact('delete', (tx) => {
      for (const id of store.members('bindingsByElement', api)) tx.delete(id);
      tx.delete(api);
    });
    expect(words()).toBe('a free end connects to Orders');
  });
});
