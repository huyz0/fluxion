// FR-AI-011: the authoring guide is generated into the docs site and folded into llms.txt; a guide page that names an id the catalog lacks fails.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCS = join(import.meta.dirname, 'content', 'docs');
const GUIDE = readFileSync(join(DOCS, 'reference', 'authoring-guide.md'), 'utf8');
const BUILT = join(import.meta.dirname, '..', 'dist');

/** The `pack:name` ids a markdown text names in backticks. */
const idsIn = (text: string): string[] => [...text.matchAll(/`([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)`/g)].map((m) => m[1] as string);

describe('the authoring guide (FR-AI-011)', () => {
  const catalogued = new Set(idsIn(GUIDE));
  const packs = new Set([...catalogued].map((id) => id.split(':')[0]));

  it('FR-AI-011: the generated guide holds the cheat sheet, the catalog and an example', () => {
    expect(GUIDE).toContain('## FluxScript cheat sheet');
    expect(GUIDE).toContain('## Fluxion catalog');
    expect(catalogued).toContain('basic:rect');
    expect(GUIDE).toContain('```yaml flux');
  });

  it('FR-AI-011: every catalogued id a guide page names is in the catalog (IF a guide names a missing id THEN the build fails)', () => {
    const guides = readdirSync(join(DOCS, 'guides')).filter((f) => f.endsWith('.md'));
    expect(guides.length).toBeGreaterThan(0);
    const missing = guides.flatMap((f) =>
      idsIn(readFileSync(join(DOCS, 'guides', f), 'utf8'))
        .filter((id) => packs.has(id.split(':')[0]) && !catalogued.has(id))
        .map((id) => `${f}: ${id}`),
    );
    expect(missing).toEqual([]);
  });

  // the build output exists after `pnpm run build`; a source-only checkout has none
  it.skipIf(!existsSync(join(BUILT, 'llms.txt')))('FR-AI-011: the build output holds llms.txt and llms-full.txt with the guide in the full one', () => {
    expect(existsSync(join(BUILT, 'llms.txt'))).toBe(true);
    expect(readFileSync(join(BUILT, 'llms-full.txt'), 'utf8')).toContain('Authoring guide for AI');
  });
});
