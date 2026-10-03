import { describe, expect, it } from 'vitest';
import { FONT_MAX_BYTES, readFontFile } from './font-file.js';

const text = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

/** A minimal TrueType or OpenType file: a table directory with `name` and `OS/2` tables, as much as the reader reads. */
function sfnt(
  options: { signature?: string; family?: string; subfamily?: string; weight?: number; italic?: boolean; noName?: boolean; noOs2?: boolean } = {},
): Uint8Array {
  const {
    signature = '\u0000\u0001\u0000\u0000',
    family = 'Fx Test',
    subfamily = 'Regular',
    weight = 400,
    italic = false,
    noName = false,
    noOs2 = false,
  } = options;
  const utf16 = (text: string) => [...text].flatMap((c) => [0, c.charCodeAt(0)]);
  const records = [
    { id: 1, bytes: utf16(family) },
    { id: 2, bytes: utf16(subfamily) },
  ];
  const strings = records.flatMap((r) => r.bytes);
  const nameBytes: number[] = [0, 0, 0, records.length, 0, 6 + records.length * 12];
  let offset = 0;
  for (const r of records) {
    nameBytes.push(0, 3, 0, 1, 0x04, 0x09, 0, r.id, (r.bytes.length >> 8) & 255, r.bytes.length & 255, (offset >> 8) & 255, offset & 255);
    offset += r.bytes.length;
  }
  nameBytes.push(...strings);
  const os2 = new Uint8Array(78);
  new DataView(os2.buffer).setUint16(4, weight);
  new DataView(os2.buffer).setUint16(62, italic ? 1 : 0);
  const present = [...(noName ? [] : [{ tag: 'name', data: Uint8Array.from(nameBytes) }]), ...(noOs2 ? [] : [{ tag: 'OS/2', data: os2 }])];
  const head = 12 + present.length * 16;
  const out = new Uint8Array(head + present.reduce((n, t) => n + t.data.length, 0));
  const view = new DataView(out.buffer);
  out.set(text(signature), 0);
  view.setUint16(4, present.length);
  let at = head;
  present.forEach((t, i) => {
    out.set(text(t.tag), 12 + i * 16);
    view.setUint32(12 + i * 16 + 8, at);
    view.setUint32(12 + i * 16 + 12, t.data.length);
    out.set(t.data, at);
    at += t.data.length;
  });
  return out;
}

describe('reading an uploaded font file (FR-THM-008, ADR-0022)', () => {
  it('FR-THM-008: TrueType and OpenType files give their family, weight and style from the name and OS/2 tables', () => {
    expect(readFontFile(sfnt())).toEqual({ ok: true, value: { format: 'ttf', family: 'Fx Test', weight: 400, style: 'normal' } });
    expect(readFontFile(sfnt({ signature: 'OTTO', weight: 700, italic: true, family: 'Fx Display' }))).toEqual({
      ok: true,
      value: { format: 'otf', family: 'Fx Display', weight: 700, style: 'italic' },
    });
    expect(readFontFile(sfnt({ signature: 'true' })).ok).toBe(true);
    // a subfamily that says Italic is italic even when OS/2 does not; a file without the tables says what it has
    expect(readFontFile(sfnt({ subfamily: 'Bold Italic', italic: false }))).toMatchObject({ ok: true, value: { style: 'italic' } });
    expect(readFontFile(sfnt({ noOs2: true }))).toEqual({ ok: true, value: { format: 'ttf', family: 'Fx Test', style: 'normal' } });
    expect(readFontFile(sfnt({ noName: true }))).toEqual({ ok: true, value: { format: 'ttf', weight: 400, style: 'normal' } });
    expect(readFontFile(sfnt({ weight: 0 }))).toMatchObject({ ok: true, value: { family: 'Fx Test' } });
  });

  it('FR-THM-008: a WOFF2 file is accepted by its signature and gives no names', () => {
    expect(readFontFile(text('wOF2....'))).toEqual({ ok: true, value: { format: 'woff2' } });
  });

  it('FR-THM-008: bytes that are not a font are rejected with a diagnostic', () => {
    const code = (bytes: Uint8Array) => {
      const r = readFontFile(bytes);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code(text('GIF89a......'))).toBe('FONT_FORMAT');
    expect(code(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('FONT_FORMAT');
    expect(code(new Uint8Array(0))).toBe('FONT_FORMAT');
    expect(code(text('abc'))).toBe('FONT_FORMAT');
    // a collection and WOFF 1 are named for what they are
    const collection = readFontFile(text('ttcf....'));
    expect(!collection.ok && collection.error.message).toContain('collection');
    const woff = readFontFile(text('wOFF....'));
    expect(!woff.ok && woff.error.message).toContain('WOFF 1');
    // over 5 MB, whatever it starts with
    expect(code(new Uint8Array(FONT_MAX_BYTES + 1))).toBe('FONT_TOO_LARGE');
    // tables that do not parse: a header that ends early, a directory that does not fit, a table that runs past the file
    expect(code(text('OTTO\u0000'))).toBe('FONT_CORRUPT');
    const noTables = sfnt();
    new DataView(noTables.buffer).setUint16(4, 0);
    expect(code(noTables)).toBe('FONT_CORRUPT');
    const longDirectory = sfnt();
    new DataView(longDirectory.buffer).setUint16(4, 500);
    expect(code(longDirectory)).toBe('FONT_CORRUPT');
    const pastEnd = sfnt();
    new DataView(pastEnd.buffer).setUint32(12 + 12, 1_000_000);
    expect(code(pastEnd)).toBe('FONT_CORRUPT');
  });

  it('FR-THM-008: a name table of many records pointing at one long string is read in bounded time and gives no oversized name', () => {
    // 5 000 records, all of them the family (id 1) at the same offset with the longest length: only one is decoded, and over 512 bytes is skipped
    const count = 5_000;
    const strings = new Uint8Array(64);
    const table = new Uint8Array(6 + count * 12 + strings.length);
    const tv = new DataView(table.buffer);
    tv.setUint16(2, count);
    tv.setUint16(4, 6 + count * 12);
    for (let i = 0; i < count; i++) {
      const at = 6 + i * 12;
      tv.setUint16(at, 3);
      tv.setUint16(at + 4, 0x409);
      tv.setUint16(at + 6, i === 0 ? 1 : 1);
      tv.setUint16(at + 8, i === 0 ? 8 : 60_000);
      tv.setUint16(at + 10, 0);
    }
    for (let i = 0; i < 4; i++) tv.setUint16(6 + count * 12 + i * 2, 'Test'.charCodeAt(i));
    const file = new Uint8Array(12 + 16 + table.length);
    const fv = new DataView(file.buffer);
    file.set(text('\u0000\u0001\u0000\u0000'), 0);
    fv.setUint16(4, 1);
    file.set(text('name'), 12);
    fv.setUint32(12 + 8, 28);
    fv.setUint32(12 + 12, table.length);
    file.set(table, 28);
    const read = readFontFile(file);
    expect(read).toEqual({ ok: true, value: { format: 'ttf', family: 'Test' } });
  });
});
