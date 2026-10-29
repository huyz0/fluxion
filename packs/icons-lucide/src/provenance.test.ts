// The icons-lucide credits name their pinned source truthfully (NFR-LIC-003, ADR-0050, M18.162, cp20 F2): the credited hash
// and revision are the corpus manifest's `iconify-lucide` entry and the pinned file's own hash, the notices are the pinned
// licence text split as scripts/packs/lucide.mjs splits it, and every icon is an icon (not an alias) of the pinned collection.
import { describe, expect, it } from 'vitest';
import { iconsLucideSource } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const raw = (files: Record<string, string>): string => Object.values(files)[0] ?? '';
const manifest = JSON.parse(raw(import.meta.glob('../../../specs/import/corpus/manifest.json', { query: '?raw', import: 'default', eager: true }))) as {
  readonly sources: readonly { readonly id: string; readonly repository: string; readonly commit: string; readonly noticeSha256: string }[];
  readonly iconify: readonly { readonly source: string; readonly path: string; readonly sha256: string }[];
};
const collectionText = raw(import.meta.glob('../../../specs/import/corpus/iconify/lucide.json', { query: '?raw', import: 'default', eager: true }));
const noticeText = raw(import.meta.glob('../../../specs/import/corpus/licenses/lucide.txt', { query: '?raw', import: 'default', eager: true }));

const sha256 = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('the icons-lucide provenance (NFR-LIC-003, FR-LIB-007)', () => {
  const source = manifest.sources.find((s) => s.id === 'iconify-lucide');
  const file = manifest.iconify.find((f) => f.source === 'iconify-lucide');
  const credits = iconsLucideSource.credits ?? [];

  it('credits the pinned collection by the manifest entry and the file’s own hash', async () => {
    expect(source).toBeDefined();
    expect(file?.path).toBe('iconify/lucide.json');
    const hash = await sha256(collectionText);
    expect(hash).toBe(file?.sha256);
    expect(credits.map((c) => c.id)).toEqual(['lucide', 'feather']);
    for (const credit of credits)
      expect(credit.source).toEqual({ kind: 'upstream', reference: 'iconify:lucide', sha256: hash, revision: `${source?.repository}@${source?.commit}` });
  });

  it('carries the pinned licence text verbatim, Lucide’s part and Feather’s', async () => {
    expect(await sha256(noticeText)).toBe(source?.noticeSha256);
    const [lucide, feather] = noticeText.split(/\n---\n/).map((part) => part.trim());
    expect(credits.map((c) => c.notice)).toEqual([lucide, feather]);
  });

  it('draws only icons of the pinned collection', () => {
    const icons = (JSON.parse(collectionText) as { readonly icons: Readonly<Record<string, unknown>> }).icons;
    const names = iconsLucideSource.definitions.map(({ def }) => def.id.replace(/^lucide:/, ''));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !Object.hasOwn(icons, name))).toEqual([]);
  });
});
