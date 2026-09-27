import { describe, expect, it } from 'vitest';
import { screenRecordSchema } from './screen.js';

const base = { id: 's1', type: 'screen', index: 'a0', name: 'Intro' };

describe('screen record', () => {
  it('FR-SCR-001: WHEN a screen omits size THE SYSTEM SHALL default to 1920×1080', () => {
    const r = screenRecordSchema.safeParse(base);
    expect(r.success && r.data.size).toEqual({ w: 1920, h: 1080 });
    expect(r.success && r.data.kind).toBe('fixed');
  });

  it('FR-SCR-001: keeps an explicit size and an infinite canvas with a viewport', () => {
    expect(screenRecordSchema.parse({ ...base, size: { w: 1080, h: 1920 } }).size).toEqual({ w: 1080, h: 1920 });
    const inf = screenRecordSchema.parse({ ...base, kind: 'infinite', viewport: { x: -100, y: 0, w: 800, h: 600 } });
    expect(inf.kind).toBe('infinite');
    expect(inf.viewport).toEqual({ x: -100, y: 0, w: 800, h: 600 });
  });

  it('FR-SCR-001: background is a colour, a token, a gradient or an image', () => {
    const backgrounds = [
      '#0b1020',
      'oklch(0.7 0.1 250)',
      '{color.surface}',
      { token: '{color.brand}', transform: { alpha: 0.5 } },
      {
        type: 'linear-gradient',
        angle: 90,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '{color.brand}' },
        ],
      },
      { type: 'image', assetId: 'img1', fit: 'contain' },
    ];
    for (const background of backgrounds) expect(screenRecordSchema.safeParse({ ...base, background }).success, JSON.stringify(background)).toBe(true);
    expect(screenRecordSchema.parse({ ...base, background: { type: 'image', assetId: 'img1' } }).background).toMatchObject({ fit: 'cover' });
  });

  it('rejects a bad index, a non-positive size and a malformed background', () => {
    const bad = [
      { ...base, index: 'a00' },
      { ...base, index: 3 },
      { ...base, size: { w: 0, h: 10 } },
      { ...base, background: '{color' },
      { ...base, background: { type: 'linear-gradient', stops: [{ offset: 0, color: '#000' }] } },
      { ...base, background: { type: 'image', assetId: 'has space' } },
      { ...base, id: '' },
      { ...base, kind: 'infinite' },
    ];
    for (const b of bad) expect(screenRecordSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    const noViewport = screenRecordSchema.safeParse({ ...base, kind: 'infinite' });
    expect(noViewport.success ? [] : noViewport.error.issues.map((i) => i.path.join('/'))).toEqual(['viewport']);
  });

  it('FR-DOC-005: keeps unknown keys on the record and in nested objects', () => {
    const parsed = screenRecordSchema.parse({ ...base, future: { x: 1 }, size: { w: 10, h: 20, unit: 'px' } });
    expect(parsed['future']).toEqual({ x: 1 });
    expect(parsed.size['unit']).toBe('px');
  });
});
