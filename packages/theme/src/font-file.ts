// Reading a font file a user brings (FR-THM-008, ADR-0022): the format is recognised by the first bytes, not by the file name or
// the media type; a collection, a WOFF 1 file, anything over 5 MB or a file whose tables do not parse is refused; the family, weight
// and style come from the `name` and `OS/2` tables of a TrueType or OpenType file. A WOFF2 file keeps its tables Brotli-compressed
// as one stream, which a pure package cannot open: it is accepted by its signature and gives no names (the caller asks for them).
// Pure: bytes in, a result out.
import { err, ok, type Result } from '@fluxion/schema';
import type { ThemeError } from './errors.js';

/**
 * The formats a font upload may have.
 *
 * @public
 */
export type FontFormat = 'woff2' | 'ttf' | 'otf';

/**
 * What a font file says about itself.
 *
 * @public
 */
export type FontFileInfo = {
  /** The format, from the first bytes. */
  readonly format: FontFormat;
  /** The family (typographic family, else the family) of a TrueType or OpenType file; absent for WOFF2 or a file without a name table. */
  readonly family?: string;
  /** The CSS weight from `OS/2` (1 to 1000); absent when there is no `OS/2` table. */
  readonly weight?: number;
  /** The style from `OS/2` and the subfamily name; absent when neither says. */
  readonly style?: 'normal' | 'italic';
};

/**
 * The largest font file taken (5 MB, ADR-0022).
 *
 * @public
 */
export const FONT_MAX_BYTES: number = 5 * 1024 * 1024;

const tag = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);
const fail = (code: ThemeError['code'], message: string): Result<never, ThemeError> => err({ code, message });

/** The format named by the signature, or why the file is not taken. */
function formatOf(b: Uint8Array): Result<FontFormat, ThemeError> {
  const sig = tag(b, 0);
  if (sig === 'wOF2') return ok('woff2');
  if (sig === '\u0000\u0001\u0000\u0000' || sig === 'true') return ok('ttf');
  if (sig === 'OTTO') return ok('otf');
  if (sig === 'ttcf') return fail('FONT_FORMAT', 'a font collection (.ttc) is not taken: upload one font');
  if (sig === 'wOFF') return fail('FONT_FORMAT', 'a WOFF 1 file is not taken: upload WOFF2, TrueType or OpenType');
  return fail('FONT_FORMAT', 'the file is not a font: expected WOFF2, TrueType or OpenType');
}

type Table = { readonly offset: number; readonly length: number };

/** The table directory of an sfnt file, every entry checked to lie inside the file. */
function tables(view: DataView): Result<ReadonlyMap<string, Table>, ThemeError> {
  if (view.byteLength < 12) return fail('FONT_CORRUPT', 'the file ends inside the font header');
  const count = view.getUint16(4);
  if (count === 0 || 12 + count * 16 > view.byteLength) return fail('FONT_CORRUPT', 'the table directory does not fit in the file');
  const found = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > view.byteLength)
      return fail('FONT_CORRUPT', `table ${tag(new Uint8Array(view.buffer, view.byteOffset), at)} runs past the end of the file`);
    found.set(tag(new Uint8Array(view.buffer, view.byteOffset), at), { offset, length });
  }
  return ok(found);
}

/** A name record's text: UTF-16BE (Windows, Unicode) or single bytes (Macintosh Roman, read as Latin-1). */
function decode(view: DataView, at: number, length: number, platform: number): string {
  const units: number[] = [];
  if (platform === 1) for (let i = 0; i < length; i++) units.push(view.getUint8(at + i));
  else for (let i = 0; i + 1 < length; i += 2) units.push(view.getUint16(at + i));
  return String.fromCharCode(...units);
}

/** The longest name taken, in bytes: a name of a family or style is short, and a hostile table may point many records at one huge string. */
const NAME_MAX_BYTES = 512;

type NameRecord = { readonly id: number; readonly english: boolean; readonly platform: number; readonly at: number; readonly length: number };

/** The name records of a `name` table that can be read (a record of another platform, over {@link NAME_MAX_BYTES}, or with its string outside the file is left out). Nothing is decoded here. */
function nameRecords(view: DataView, table: Table): NameRecord[] {
  const count = view.getUint16(table.offset + 2);
  const strings = table.offset + view.getUint16(table.offset + 4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count && 6 + (i + 1) * 12 <= table.length; i++) {
    const at = table.offset + 6 + i * 12;
    const [platform, language, id, length, offset] = [
      view.getUint16(at),
      view.getUint16(at + 4),
      view.getUint16(at + 6),
      view.getUint16(at + 8),
      view.getUint16(at + 10),
    ];
    if (platform > 3 || platform === 2 || length === 0 || length > NAME_MAX_BYTES || strings + offset + length > view.byteLength) continue;
    records.push({ id, english: language === 0x409 || language === 0, platform, at: strings + offset, length });
  }
  return records;
}

/** The text of the first of `ids` that has a record, English preferred: only that record is decoded. */
function nameOf(view: DataView, records: readonly NameRecord[], ids: readonly number[]): string | undefined {
  for (const id of ids) {
    const of = records.filter((r) => r.id === id);
    const pick = of.find((r) => r.english) ?? of[0];
    if (pick !== undefined) return decode(view, pick.at, pick.length, pick.platform);
  }
  return undefined;
}

/** The weight and the italic flag of the `OS/2` table. */
function os2(view: DataView, table: Table | undefined): { weight?: number; italic?: boolean } {
  if (table === undefined || table.length < 64) return {};
  const weight = view.getUint16(table.offset + 4);
  return { ...(weight >= 1 && weight <= 1000 && { weight }), italic: (view.getUint16(table.offset + 62) & 1) === 1 };
}

/** What the tables of a TrueType or OpenType file say: family, weight and style. */
function describe(view: DataView, directory: ReadonlyMap<string, Table>): Omit<FontFileInfo, 'format'> {
  const name = directory.get('name');
  // the table is parsed once, whichever names are asked for
  const records = name === undefined || name.length < 6 ? [] : nameRecords(view, name);
  const family = nameOf(view, records, [16, 1]);
  const subfamily = nameOf(view, records, [17, 2]);
  const { weight, italic } = os2(view, directory.get('OS/2'));
  const style = italic === true || /italic|oblique/i.test(subfamily ?? '') ? 'italic' : italic === false || subfamily !== undefined ? 'normal' : undefined;
  return { ...(family !== undefined && { family }), ...(weight !== undefined && { weight }), ...(style !== undefined && { style }) };
}

/**
 * What the font file `bytes` is: FONT_TOO_LARGE over {@link FONT_MAX_BYTES}, FONT_FORMAT for anything but WOFF2, TrueType or
 * OpenType (a collection and WOFF 1 included), FONT_CORRUPT when the tables of a TrueType or OpenType file do not lie inside it.
 *
 * @public
 */
export function readFontFile(bytes: Uint8Array): Result<FontFileInfo, ThemeError> {
  if (bytes.byteLength > FONT_MAX_BYTES)
    return fail('FONT_TOO_LARGE', `the file is ${bytes.byteLength} bytes; fonts over ${FONT_MAX_BYTES} bytes are not taken`);
  if (bytes.byteLength < 4) return fail('FONT_FORMAT', 'the file is not a font: it is shorter than a font signature');
  const format = formatOf(bytes);
  if (!format.ok || format.value === 'woff2') return format.ok ? ok({ format: 'woff2' }) : format;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directory = tables(view);
  return directory.ok ? ok({ format: format.value, ...describe(view, directory.value) }) : directory;
}
