import { describe, expect, it } from 'vitest';
import { statusText } from './autosave-bar.js';
import type { AutosaveState } from './document-autosave.js';

const state = (protection: AutosaveState['protection'], write: AutosaveState['write']): AutosaveState => ({ protection, write });

describe('the autosave status line (FR-FIL-007)', () => {
  it('FR-FIL-007: protected storage says changes are kept, and unprotected storage says the browser may clear them', () => {
    expect(statusText(state('protected', { kind: 'saved' }))).toBe('Changes are kept on this device.');
    expect(statusText(state('may-be-cleared', { kind: 'saved' }))).toMatch(/may clear them/);
  });

  it('FR-FIL-007: a waiting write says it is saving, and storage that is not there says autosave is unavailable', () => {
    expect(statusText(state('protected', { kind: 'pending' }))).toMatch(/Saving/);
    expect(statusText(state('unavailable', { kind: 'saved' }))).toMatch(/unavailable/);
  });

  it('NFR-REL-001: a failed write says why and when the next try is', () => {
    expect(statusText(state('protected', { kind: 'failed', message: 'QuotaExceededError', retryInMs: 2000 }))).toBe(
      'Autosave failed (QuotaExceededError); trying again in 2 s.',
    );
  });
});
