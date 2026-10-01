import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createSession } from './session.js';
import { editSelectedText, hasText } from './text-edit.js';

function setup() {
  const b = documentBuilder({ seed: 5 });
  const screen = b.screen();
  const shape = b.rect(screen, { label: 'a' });
  const text = b.text(screen, 'b');
  const other = b.rect(screen);
  const connector = b.connect(shape, other);
  const core = createCore(b.build());
  return { view: core.store, session: createSession('d'), screen, shape, text, other, connector };
}

describe('text-edit (FR-TXT-003)', () => {
  it('FR-TXT-003: shapes and text elements have text to edit; screens, connectors and nothing do not', () => {
    const { view, screen, shape, text, connector } = setup();
    expect([shape, text].map((id) => hasText(view, id))).toEqual([true, true]);
    expect([screen, connector, 'missing' as RecordId].map((id) => hasText(view, id))).toEqual([false, false, false]);
  });

  it('FR-TXT-003: the one selected element with text opens for editing; any other selection does not', () => {
    const { view, session, shape, text, connector } = setup();
    expect(editSelectedText(session, view)).toBe(false);
    session.selection.set([shape, text]);
    expect(editSelectedText(session, view)).toBe(false);
    expect(session.editing.get()).toBeUndefined();
    session.selection.set([connector]);
    expect(editSelectedText(session, view)).toBe(false);
    session.selection.set([text]);
    expect(editSelectedText(session, view)).toBe(true);
    expect(session.editing.get()).toBe(text);
  });
});
