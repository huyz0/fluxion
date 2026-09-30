import { describe, expect, it } from 'vitest';
import { fitCamera, readOnly } from './present-mode.js';

describe('present in place, pure parts (FR-EDT-009)', () => {
  it('FR-EDT-009: the present camera maps the stage to the fitted screen', () => {
    // 1000 × 500 into 500 × 500: half size, centred vertically (125 px bands)
    expect(fitCamera({ x: 0, y: 0, w: 1000, h: 500 }, { w: 500, h: 500 })).toEqual({ x: 0, y: -250, z: 0.5 });
    // centred horizontally too, at twice the size: 100 × 100 into 600 × 200 (200 px bands)
    expect(fitCamera({ x: 0, y: 0, w: 100, h: 100 }, { w: 600, h: 200 })).toEqual({ x: -100, y: 0, z: 2 });
    // an infinite screen's viewport starts off the origin
    expect(fitCamera({ x: 100, y: 50, w: 200, h: 100 }, { w: 400, h: 200 })).toEqual({ x: 100, y: 50, z: 2 });
  });

  it('FR-EDT-009: while presenting every write is refused as read-only', () => {
    const r = readOnly('element.delete', { id: 'x' });
    expect(r).toEqual({ ok: false, error: { code: 'TX_READ_ONLY', message: 'presenting: the document is read-only', diagnostics: [] } });
  });
});
