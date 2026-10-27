import { afterEach, describe, expect, it } from 'vitest';
import { clipboardCatcher } from './clipboard-catcher.js';

const catchers: ReturnType<typeof clipboardCatcher>[] = [];
const made = () => {
  const c = clipboardCatcher(document);
  catchers.push(c);
  return c;
};
const canvas = () => {
  const div = document.createElement('div');
  div.tabIndex = 0;
  document.body.append(div);
  return div;
};

afterEach(() => {
  for (const c of catchers.splice(0)) c.dispose();
  document.body.replaceChildren();
});

describe('the clipboard catcher (FR-EDT-007, NFR-PORT-001)', () => {
  it('takes the focus with its placeholder selected, owns only its own text area, and gives the focus back', () => {
    const c = made();
    const before = canvas();
    before.focus();
    expect(c.owns(null)).toBe(false);
    c.route();
    const area = document.activeElement;
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    const text = area as HTMLTextAreaElement;
    expect([text.value, text.selectionStart, text.selectionEnd]).toEqual([' ', 0, 1]);
    expect([text.getAttribute('aria-hidden'), text.tabIndex]).toEqual(['true', -1]);
    expect(c.owns(area)).toBe(true);
    expect(c.owns(before)).toBe(false);
    c.restore();
    expect(document.activeElement).toBe(before);
    expect(text.value).toBe('');
  });

  it('is made once, and a second route keeps the first focus', () => {
    const c = made();
    const before = canvas();
    before.focus();
    c.route();
    c.route();
    expect(document.querySelectorAll('[data-fx-clipboard-catcher]')).toHaveLength(1);
    c.restore();
    expect(document.activeElement).toBe(before);
  });

  it('leaves a focus that moved on alone, and blurs when the old target is gone', () => {
    const c = made();
    const before = canvas();
    before.focus();
    c.route();
    const elsewhere = canvas();
    elsewhere.focus();
    c.restore();
    expect(document.activeElement).toBe(elsewhere);
    c.route();
    elsewhere.remove();
    c.restore();
    expect(document.activeElement).toBe(document.body);
  });

  it('gives the page its text selection back', () => {
    const c = made();
    const before = canvas();
    const text = document.createElement('p');
    text.textContent = 'selected text';
    document.body.append(text);
    getSelection()?.selectAllChildren(text);
    before.focus();
    c.route();
    expect(getSelection()?.toString()).not.toBe('selected text');
    c.restore();
    expect(document.activeElement).toBe(before);
    expect(getSelection()?.toString()).toBe('selected text');
  });

  it('dispose removes the text area', () => {
    const c = made();
    c.route();
    c.dispose();
    expect(document.querySelector('[data-fx-clipboard-catcher]')).toBeNull();
    expect(c.owns(document.activeElement)).toBe(false);
  });
});
