import type { LogEntry } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { diagnosticReport } from './diagnostic-report.js';

const SENTINEL = 'ZXQ-SENTINEL-4471';

describe('the diagnostic report (NFR-OBS-002)', () => {
  it('NFR-OBS-002: the report holds no document text', () => {
    // the sentinel is in every place a document keeps words: a title, names, labels, slugs, text, URLs, asset names, kinds and ids
    const records = {
      [`id-${SENTINEL}`]: { id: `id-${SENTINEL}`, type: 'document', title: SENTINEL, meta: { note: SENTINEL } },
      s1: { type: 'screen', name: SENTINEL, notes: SENTINEL },
      e1: {
        type: 'element',
        kind: 'text',
        name: SENTINEL,
        semantic: { label: SENTINEL, slug: SENTINEL },
        text: { type: 'doc', content: [{ type: 'text', text: SENTINEL }] },
      },
      e2: { type: 'element', kind: SENTINEL, link: `https://${SENTINEL}.example/` },
      e3: { type: 'element', kind: 'shape', defId: 'basic:rect' },
      a1: { type: 'asset', name: `${SENTINEL}.png`, mime: 'image/png' },
      e4: { type: 'element', kind: 'zxq-sentinel-roadmap' },
      e5: { type: 'element', kind: 'zxq:sentinel-plugin' },
      t1: { type: 'zxq-sentinel-type' },
      odd: SENTINEL,
      [SENTINEL]: null,
    };
    const entries: LogEntry[] = [
      { level: 'warn', namespace: 'studio:open', message: `could not read ${SENTINEL}`, fields: { path: SENTINEL } },
      { level: 'error', namespace: SENTINEL, message: SENTINEL, fields: {} },
      { level: 'error', namespace: '', message: 'x', fields: {} },
      { level: 'warn', namespace: 'zxq-sentinel-area:deep', message: 'x', fields: {} },
    ];
    const text = diagnosticReport({ versions: { studio: '0.0.0', schema: '1.0' }, records, entries, userAgent: 'Mozilla/5.0 test' });
    expect(text).not.toContain(SENTINEL);
    expect(text.toLowerCase()).not.toContain(SENTINEL.toLowerCase());
    // a lower-case, token-shaped name (a plugin's kind, an unknown type, a made-up area) is not a key of the report either
    expect(text).not.toContain('zxq');
    const report = JSON.parse(text);
    expect(report.versions).toEqual({ studio: '0.0.0', schema: '1.0' });
    expect(report.document.records).toBe(11);
    expect(report.document.byType).toMatchObject({ document: 1, screen: 1, element: 5, asset: 1, other: 3 });
    // a kind that is not one of the studio's own tokens is counted as other, a defined one by name
    expect(report.document.elementsByKind).toEqual({ text: 1, other: 3, shape: 1 });
    expect(report.problems).toEqual({ byLevel: { warn: 2, error: 2 }, byNamespace: { studio: 1, other: 2, root: 1 } });
  });
});
