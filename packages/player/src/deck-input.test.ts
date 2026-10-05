import { describe, expect, it } from 'vitest';
import { deckAction, NumberEntry } from './deck-input.js';

describe("the deck's keys (FR-PRS-002)", () => {
  it('FR-PRS-002: arrows, page keys, space, enter and backspace move; Home and End jump; F is full screen; other keys are nothing', () => {
    const kind = (key: string) => deckAction(key, false)?.kind;
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']) expect(kind(key), key).toBe('next');
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']) expect(kind(key), key).toBe('prev');
    expect(kind('Home')).toBe('first');
    expect(kind('End')).toBe('last');
    expect(kind('f')).toBe('fullscreen');
    expect(kind('F')).toBe('fullscreen');
    for (const key of ['a', 'Tab', 'Escape', 'F5', 'Shift']) expect(kind(key), key).toBeUndefined();
    expect(deckAction('7', false)).toEqual({ kind: 'digit', digit: '7' });
  });

  it('FR-PRS-002: while a number is being typed, Enter commits it, Backspace erases a digit and Escape drops it', () => {
    expect(deckAction('Enter', true)?.kind).toBe('commit');
    expect(deckAction('Backspace', true)?.kind).toBe('erase');
    expect(deckAction('Escape', true)?.kind).toBe('cancel');
    expect(deckAction('ArrowRight', true)?.kind).toBe('next');
  });

  it('FR-PRS-002: a screen number is typed digit by digit, taken once, and 0 or nothing is no screen', () => {
    const entry = new NumberEntry();
    expect(entry.typing).toBe(false);
    expect(entry.take()).toBeUndefined();
    entry.push('1');
    entry.push('2');
    expect(entry.typing).toBe(true);
    expect(entry.text).toBe('12');
    entry.erase();
    expect(entry.text).toBe('1');
    entry.push('2');
    expect(entry.take()).toBe(12);
    expect(entry.typing).toBe(false);
    entry.push('0');
    expect(entry.take()).toBeUndefined();
    for (const d of '123456') entry.push(d);
    expect(entry.text).toBe('1234');
    entry.clear();
    expect(entry.text).toBe('');
  });
});
