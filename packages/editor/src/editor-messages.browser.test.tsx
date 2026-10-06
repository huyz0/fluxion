import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { HistoryButtons } from './history-buttons.js';
import { i18n } from './i18n.js';
import { newDocument } from './new-document.js';
import { PANEL_NAMES } from './panels.js';

/** The plain texts of the active catalog (a compiled message that is one string has no placeholder), by id. */
const plainTexts = (): Map<string, string> =>
  new Map(Object.entries(i18n.messages).flatMap(([id, m]) => (Array.isArray(m) && m.length === 1 && typeof m[0] === 'string' ? [[id, m[0]] as const] : [])));

describe('the editor renders its English messages (NFR-I18N-001)', () => {
  it('NFR-I18N-001: the editor renders its English messages: the English catalog is active and every message id resolves to its text', () => {
    expect(i18n.locale).toBe('en');
    const texts = plainTexts();
    expect(texts.size).toBeGreaterThan(80);
    // an id reads, from the compiled catalog alone (no fallback text), as the text the source says
    for (const [id, text] of texts) expect(i18n._(id)).toBe(text);
  });

  it('NFR-I18N-001: the editor renders its English messages: components and the lazily read panel names show catalog text', async () => {
    const known = new Set(plainTexts().values());
    for (const name of Object.values(PANEL_NAMES)) expect(known.has(name)).toBe(true);
    const core = createCore(newDocument(seededRandom(5)));
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<HistoryButtons store={core.store} base={[]} overrides={{}} mac={false} run={() => true} />));
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Undo', 'Redo']);
    act(() => root.unmount());
    host.remove();
  });
});
