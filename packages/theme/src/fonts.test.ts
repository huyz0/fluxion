import { describe, expect, it } from 'vitest';
import { createFontRegistry, type FontFaceDef } from './fonts.js';

/** A face; an `undefined` override removes the field (an exact-optional field cannot hold undefined). */
const face = (over: { [K in keyof FontFaceDef]?: FontFaceDef[K] | undefined } = {}): FontFaceDef =>
  ({ family: 'Inter', weight: 400, style: 'normal', source: 'bundled', file: 'fonts/a.woff2', license: 'OFL-1.1', ...over }) as FontFaceDef;

describe('the font registry (FR-THM-008)', () => {
  it('FR-THM-008: faces of a family are listed with their source, in the order they came', () => {
    const fonts = createFontRegistry();
    expect(
      fonts.register([face(), face({ weight: 700 }), face({ family: 'Mine', source: 'upload', file: undefined, assetId: 'A1', license: 'unknown' })]).ok,
    ).toBe(true);
    expect(fonts.families().map((f) => [f.family, f.source, f.faces.length])).toEqual([
      ['Inter', 'bundled', 2],
      ['Mine', 'upload', 1],
    ]);
    expect(fonts.faces('Inter').map((f) => f.weight)).toEqual([400, 700]);
    expect(fonts.faces('Nope')).toEqual([]);
  });

  it('FR-THM-008: a face that is not one, or one held twice, is refused and nothing of its batch is kept', () => {
    const fonts = createFontRegistry();
    const refused = (faces: FontFaceDef[]) => {
      const r = fonts.register(faces);
      return r.ok ? undefined : r.error.code;
    };
    expect(refused([face({ family: '' })])).toBe('FONT_INVALID');
    expect(refused([face({ family: 'A<b' })])).toBe('FONT_INVALID');
    expect(refused([face({ weight: 0 })])).toBe('FONT_INVALID');
    expect(refused([face({ weight: 450.5 })])).toBe('FONT_INVALID');
    expect(refused([face({ style: 'oblique' as never })])).toBe('FONT_INVALID');
    expect(refused([face({ file: undefined })])).toBe('FONT_INVALID');
    expect(refused([face({ assetId: 'A1' })])).toBe('FONT_INVALID');
    expect(refused([face({ license: '' })])).toBe('FONT_INVALID');
    expect(refused([face({ source: 'dropbox' as never })])).toBe('FONT_INVALID');
    // the source says where the bytes are: a bundled face has a file, the others an asset
    expect(refused([face({ file: undefined, assetId: 'A1' })])).toBe('FONT_INVALID');
    expect(refused([face({ source: 'upload' })])).toBe('FONT_INVALID');
    // a batch with a good face first and a bad one after keeps neither
    expect(refused([face(), face({ weight: 0 })])).toBe('FONT_INVALID');
    expect(fonts.families()).toEqual([]);
    expect(fonts.register([face()]).ok).toBe(true);
    expect(refused([face()])).toBe('FONT_DUPLICATE');
    expect(refused([face({ weight: 500 }), face({ weight: 500 })])).toBe('FONT_DUPLICATE');
    expect(fonts.faces('Inter')).toHaveLength(1);
  });
});
