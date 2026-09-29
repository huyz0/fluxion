import { describe, expect, it } from 'vitest';
import { localSettings } from './local-settings.js';

/** A Storage whose every call throws, like blocked or full site data. */
const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('full');
  },
} as unknown as Storage;

describe('studio settings on localStorage (ADR-0029)', () => {
  it('FR-EDT-001: a setting written is read back as JSON, by key, from localStorage', () => {
    localStorage.removeItem('fx.test.a');
    const s = localSettings();
    expect(s.get('fx.test.a')).toBeUndefined();
    s.set('fx.test.a', { size: 300, on: true });
    expect(localStorage.getItem('fx.test.a')).toBe('{"size":300,"on":true}');
    expect(localSettings().get('fx.test.a')).toEqual({ size: 300, on: true });
    localStorage.removeItem('fx.test.a');
  });

  it('FR-EDT-001: broken or blocked storage reads as empty and drops writes', () => {
    localStorage.setItem('fx.test.b', '{not json');
    expect(localSettings().get('fx.test.b')).toBeUndefined();
    localStorage.removeItem('fx.test.b');
    expect(localSettings(throwing).get('k')).toBeUndefined();
    expect(() => localSettings(throwing).set('k', 1)).not.toThrow();
  });

  it('FR-EDT-001: a page whose localStorage getter throws gets settings that hold nothing', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    try {
      const s = localSettings();
      s.set('k', 1);
      expect(s.get('k')).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
});
