import { describe, expect, it } from 'vitest';
import { OUTLINE } from './__fixtures__/outline.js';
import { importMarkdown } from './markdown.js';

describe('importMarkdown in a browser (FR-IMP-002, ADR-0040)', () => {
  it('FR-IMP-002: the outline imports in Chromium, where decode-named-character-reference is aliased to its DOM-free entry', () => {
    const r = importMarkdown(`${OUTLINE}\nAT&amp;T &copy; 2026\n`);
    expect(r.ok).toBe(true);
    expect(r.flux).toContain('AT&T © 2026');
  });
});
