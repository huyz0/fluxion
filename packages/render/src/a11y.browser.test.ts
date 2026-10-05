import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder, plainText } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { renderDocumentToHtml } from './ssr.js';
import { testRegistries } from './test-registries.js';

/** The hidden words of every element of a document, by element id. */
function words(file: DocumentFile): Record<string, string> {
  const html = renderDocumentToHtml(file, { registries: testRegistries() }).html;
  const found: Record<string, string> = {};
  for (const m of html.matchAll(/<div class="fx-el" data-el-id="([^"]+)"[^>]*>(?:(?!<div class="fx-el").)*?<span class="fx-sr-only">([^<]*)<\/span>/gs))
    found[m[1] as string] = m[2] as string;
  return found;
}

describe('what a screen reader gets for what a screen draws without words (NFR-A11Y-002)', () => {
  it('NFR-A11Y-002: a connector reads "A connects to B: label" from the elements it joins, a free end says so, and a rename follows', () => {
    const b = documentBuilder({ seed: 810 });
    const screen = b.screen({ size: { w: 800, h: 600 } });
    const api = b.rect(screen, { x: 10, y: 10, w: 100, h: 50 });
    const db = b.text(screen, 'Orders database', { x: 300, y: 10, w: 100, h: 50 });
    const joined = b.connect(api, db);
    const dangling = b.connect(api, { x: 500, y: 500 });
    const file = b.build();
    const records = file.records as Record<string, Record<string, unknown>>;
    records[api as string] = { ...records[api as string], semantic: { label: 'API gateway' } };
    records[joined as string] = { ...records[joined as string], labels: [{ text: plainText('reads and writes'), position: 0.5 }] };
    const read = words({ ...file, records } as unknown as DocumentFile);
    expect(read[joined]).toBe('API gateway connects to Orders database: reads and writes');
    expect(read[dangling]).toBe('API gateway connects to a free end');
    // a rename changes the words
    records[api as string] = { ...records[api as string], semantic: { label: 'Edge' } };
    expect(words({ ...file, records } as unknown as DocumentFile)[joined]).toBe('Edge connects to Orders database: reads and writes');
  });

  it('NFR-A11Y-002: an image with a label has alt text; one without is decoration and says nothing', () => {
    const b = documentBuilder({ seed: 811 });
    const screen = b.screen({ size: { w: 800, h: 600 } });
    const file = b.build();
    const image = (id: string, semantic?: unknown) => ({
      id,
      type: 'element',
      kind: 'image',
      screenId: screen,
      index: id === 'img1' ? 'a5' : 'a6',
      transform: { x: 0, y: 0, w: 100, h: 100 },
      assetId: 'missing',
      ...(semantic === undefined ? {} : { semantic }),
    });
    const records = { ...file.records, img1: image('img1', { label: 'Quarterly revenue chart' }), img2: image('img2') };
    const read = words({ ...file, records } as unknown as DocumentFile);
    expect(read['img1' as RecordId]).toBe('Quarterly revenue chart');
    expect(read['img2' as RecordId]).toBeUndefined();
  });
});
