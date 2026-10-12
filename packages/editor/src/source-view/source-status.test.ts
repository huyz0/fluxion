import { describe, expect, it } from 'vitest';
import type { SyncResult } from './source-apply.js';
import { statusText } from './source-status.js';

const applied = (extra: Partial<SyncResult>): SyncResult => ({ status: 'applied', diagnostics: [], ...extra });

describe('source view status line', () => {
  it('FR-EDT-022: a conflict on a slug, other semantic fields, meta or params reads in words, not as a raw path', () => {
    const fields = ['semantic.slug', 'semantic.notes', 'meta.slug', 'meta.tags', 'params.radius', 'transform.x', 'semantic.label'];
    const line = statusText(applied({ conflicts: [{ label: 'api', fields }] }), 0);
    expect(line).toBe('Applied to the canvas. Overwrote canvas changes to: api (name, details, settings, position, label).');
    for (const raw of ['semantic.', 'meta.', 'params.']) expect(line).not.toContain(raw);
    // a path with no entry at all still shows, as it is, rather than nothing
    expect(statusText(applied({ conflicts: [{ label: 'a', fields: ['weird.path'] }] }), 0)).toContain('a (weird.path)');
  });

  it('FR-EDT-022: the status line names the unpaired nodes and the connectors, by their ends', () => {
    expect(statusText(applied({ unpaired: ['t1', 'a → b'] }), 0)).toBe(
      'Applied to the canvas. Could not tell which node or connector was renamed: t1, a → b. Their comments and canvas changes were removed.',
    );
  });
});
