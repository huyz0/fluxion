import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { type ClipboardPayload, copyPayload } from './clipboard.js';
import { MAX_PAYLOAD_CHARS, parsePayload, payloadHtml, payloadJson, payloadText } from './clipboard-format.js';

function payload(): ClipboardPayload {
  const b = documentBuilder({ seed: 31 });
  const s = b.screen();
  const low = b.text(s, 'second line <b>&</b>', { x: 10, y: 200, w: 100, h: 20 });
  const high = b.text(s, 'first', { x: 300, y: 0, w: 100, h: 20 });
  const left = b.text(s, 'first, left', { x: 10, y: 0, w: 100, h: 20 });
  const a = b.rect(s, { x: 0, y: 100, w: 50, h: 50 });
  const c = b.rect(s, { x: 100, y: 100, w: 50, h: 50 });
  const line = b.connect(a, c);
  const core = createCore(b.build());
  const made = copyPayload(core.store, [low, high, left, a, c, line], { docId: 'doc', screen: s });
  if (made === undefined) throw new Error('nothing copied');
  return made;
}
const withRecords = (p: ClipboardPayload, patch: (records: unknown[]) => unknown[]) => JSON.stringify({ ...p, records: patch([...p.records]) });

describe('the clipboard formats (FR-EDT-007, ADR-0020)', () => {
  it('FR-EDT-007: the payload round-trips through its JSON, validated like an opened file', () => {
    const p = payload();
    const r = parsePayload(payloadJson(p));
    expect(r.ok).toBe(true);
    expect(r.ok && r.payload).toEqual(p);
    // unknown fields and kinds of a newer minor are kept (FR-DOC-005)
    const newer = JSON.parse(payloadJson(p)) as ClipboardPayload & { future?: number };
    const extra = {
      ...newer,
      version: 2,
      schemaVersion: '1.9',
      future: 1,
      records: [
        ...newer.records,
        { id: 'HologramHologram', type: 'element', kind: 'hologram', screenId: 'x', index: 'a0', transform: { x: 0, y: 0, w: 1, h: 1 }, depth: 3 },
      ],
    };
    const kept = parsePayload(JSON.stringify(extra));
    expect(kept.ok && kept.payload.records.some((r) => (r as { kind?: string }).kind === 'hologram')).toBe(true);
    // absent assets read as none
    const { assets: _assets, ...noAssets } = p;
    expect(parsePayload(JSON.stringify(noAssets)).ok).toBe(true);
  });

  it('FR-EDT-007: what is not a valid payload is refused with a reason, and nothing of it is used', () => {
    const p = payload();
    const reason = (text: string) => {
      const r = parsePayload(text);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason('not json {')).toBe('not JSON');
    expect(reason('[1]')).toBe('not a Fluxion clipboard');
    expect(reason('"text"')).toBe('not a Fluxion clipboard');
    expect(reason(JSON.stringify({ ...p, fluxion: 'other' }))).toBe('not a Fluxion clipboard');
    expect(reason(JSON.stringify({ ...p, version: 0 }))).toBe('no payload version');
    expect(reason(JSON.stringify({ ...p, version: '1' }))).toBe('no payload version');
    for (const version of ['2.0', '1.00', 'x', '']) expect(reason(JSON.stringify({ ...p, schemaVersion: version })), version).toMatch(/cannot be pasted here/);
    expect(reason(JSON.stringify({ ...p, records: [] }))).toBe('no records');
    expect(reason(JSON.stringify({ ...p, records: 'x' }))).toBe('no records');
    expect(reason(withRecords(p, (r) => [...r, 7]))).toBe('a record is not an object');
    expect(reason(withRecords(p, (r) => [...r, { type: 'element' }]))).toBe('a record has no valid id');
    expect(reason(withRecords(p, (r) => [...r, { id: 'ScreenScreenScre1', type: 'screen' }]))).toBe('a screen record cannot be pasted');
    expect(reason(withRecords(p, (r) => [...r, { id: 'BrokenBrokenBrok1', type: 'element', kind: 'shape' }]))).toBe('record BrokenBrokenBrok1 is not valid');
    expect(
      reason(
        withRecords(p, (r) => [
          ...r,
          { id: 'BindBindBindBind1', type: 'binding', connectorId: 'nope', elementId: 'nope', end: 'source', anchor: { kind: 'auto' } },
        ]),
      ),
    ).toMatch(/joins elements that were not copied/);
    expect(reason(JSON.stringify({ ...p, assets: [{ id: 'AssetAssetAsset01', type: 'asset', hash: 'h', mime: 'image/png', size: 1, name: 'x' }] }))).toBe(
      'an asset is not valid',
    );
    const asset = { id: 'AssetAssetAsset01', type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 1, name: 'x.png' };
    expect(reason(JSON.stringify({ ...p, assets: [{ ...asset, dataUrl: 'data:image/png;base64,AAAA' }] }))).toBe('ok');
    for (const dataUrl of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'https://example.com/x.png', 7])
      expect(reason(JSON.stringify({ ...p, assets: [{ ...asset, dataUrl }] })), String(dataUrl)).toBe('an asset is not valid');
    expect(reason(JSON.stringify({ ...p, assets: 'x' }))).toBe('an asset is not valid');
    expect(reason('x'.repeat(MAX_PAYLOAD_CHARS + 1))).toBe('the clipboard holds too much');
    // two elements that are each other's parent, one that is its own, and an element twice: never written into a document
    const el = (id: string, parentId?: string) => ({
      id,
      type: 'element',
      kind: 'frame',
      screenId: 'ScreenScreenScr01',
      index: 'a0',
      transform: { x: 0, y: 0, w: 1, h: 1 },
      ...(parentId === undefined ? {} : { parentId }),
    });
    const only = (records: unknown[]) => JSON.stringify({ ...p, records });
    expect(reason(only([el('AAAAAAAAAAAAAAA1', 'BBBBBBBBBBBBBBB1'), el('BBBBBBBBBBBBBBB1', 'AAAAAAAAAAAAAAA1'), el('CCCCCCCCCCCCCCC1')]))).toBe(
      'elements are their own ancestors',
    );
    expect(reason(only([el('AAAAAAAAAAAAAAA1', 'AAAAAAAAAAAAAAA1')]))).toBe('elements are their own ancestors');
    expect(reason(only([el('AAAAAAAAAAAAAAA1'), el('AAAAAAAAAAAAAAA1')]))).toBe('an element appears twice');
    // a parent that was not copied is fine (the element lands on the screen), and so is a chain
    expect(reason(only([el('AAAAAAAAAAAAAAA1', 'ZZZZZZZZZZZZZZZ1')]))).toBe('ok');
    expect(reason(only([el('AAAAAAAAAAAAAAA1'), el('BBBBBBBBBBBBBBB1', 'AAAAAAAAAAAAAAA1'), el('CCCCCCCCCCCCCCC1', 'BBBBBBBBBBBBBBB1')]))).toBe('ok');
  });

  it('FR-EDT-007: the HTML is an outline of the copied boxes, then the payload as the text of a template', () => {
    const p = payload();
    const json = payloadJson(p);
    const html = payloadHtml(p, json);
    expect(html.startsWith('<svg')).toBe(true);
    expect(html).toContain('<template data-fluxion="1">');
    expect(html.endsWith('</template>')).toBe(true);
    // the JSON is escaped, so the template holds text, never markup from the document
    const inner = html.slice(html.indexOf('<template data-fluxion="1">') + '<template data-fluxion="1">'.length, -'</template>'.length);
    expect(inner).not.toContain('<');
    expect(inner.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).toBe(json);
    // an outline rect per copied box, placed relative to the copied bounds
    expect((html.match(/<rect /g) ?? []).length).toBe(p.records.filter((r) => r.type === 'element' && 'transform' in r).length);
    expect(html).toContain(`width="${p.bounds?.w}"`);
    // a payload with no bounds still has a picture
    expect(payloadHtml({ ...p, bounds: undefined })).toContain('viewBox="0 0 1 1"');
  });

  it('FR-EDT-007: the text is the copied labels in reading order, one per line', () => {
    const p = payload();
    // top to bottom, then left to right; markup in a label is text
    expect(payloadText(p)).toBe('first, left\nfirst\nsecond line <b>&</b>');
    expect(payloadText({ ...p, records: p.records.filter((r) => r.type === 'binding') })).toBe('');
    const empty = p.records.map((r) => ({ ...r, text: { type: 'doc', content: [{ type: 'paragraph' }] } }));
    expect(payloadText({ ...p, records: empty as never })).toBe('');
  });
});
