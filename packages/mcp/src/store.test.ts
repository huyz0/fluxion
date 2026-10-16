import { describe, expect, it } from 'vitest';
import { DocStore, MAX_OPEN_DOCS } from './store.js';

describe('the document store (FR-MCP-001, ADR-0038)', () => {
  it('FR-MCP-001: handles are doc_1, doc_2, ... and a new document is at revision 1', () => {
    const store = new DocStore();
    expect(store.create('a').doc).toMatchObject({ handle: 'doc_1', revision: 1, text: 'a' });
    expect(store.create('b', 'x.flux.json').doc).toMatchObject({ handle: 'doc_2', path: 'x.flux.json' });
  });

  it('FR-MCP-001: replacing the text raises the revision, and a stale base revision is refused', () => {
    const store = new DocStore();
    const { doc } = store.create('a');
    const r = store.replace(doc.handle, 'b', 1);
    expect(r).toMatchObject({ ok: true, doc: { revision: 2, text: 'b' } });
    const stale = store.replace(doc.handle, 'c', 1);
    expect(stale).toMatchObject({ ok: false, error: { code: 'FLX_MCP_STALE_REVISION' } });
    expect(store.get(doc.handle)).toMatchObject({ ok: true, doc: { text: 'b', revision: 2 } });
  });

  it('FR-MCP-001: an unknown handle is FLX_MCP_NO_SUCH_DOC', () => {
    expect(new DocStore().get('doc_9')).toMatchObject({ ok: false, error: { code: 'FLX_MCP_NO_SUCH_DOC' } });
  });

  it('FR-MCP-001: the 33rd document evicts the least recently used one, and reads count as use', () => {
    const store = new DocStore();
    const first = store.create('first').doc.handle;
    const second = store.create('second').doc.handle;
    for (let i = 2; i < MAX_OPEN_DOCS; i++) store.create(`d${i}`);
    expect(store.size).toBe(MAX_OPEN_DOCS);
    store.get(first); // first is now the most recently used, second the oldest
    const made = store.create('one more');
    expect(made.evicted).toBe(second);
    expect(store.size).toBe(MAX_OPEN_DOCS);
    expect(store.get(first).ok).toBe(true);
    expect(store.get(second)).toMatchObject({ ok: false, error: { code: 'FLX_MCP_DOC_EVICTED' } });
  });
});
