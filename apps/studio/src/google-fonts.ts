// Google Fonts in the studio (FR-THM-008, ADR-0022): the catalog snapshot of packs/fonts-core, loaded when the picker opens, and the
// fetch of a chosen family's weights and styles into font assets of the document. Studio only: nothing else in the editor or the player
// names googleapis.com or gstatic.com (a harness test greps for it). The network is a `fetch` port, so tests answer it.
import { addFont, type FontInput, type FontLibraryDeps } from '@fluxion/editor';
import { err, ok, type RecordId, type Result } from '@fluxion/schema';

/** One family of the catalog. */
export type CatalogFamily = {
  readonly family: string;
  readonly id: string;
  readonly category: string;
  readonly weights: readonly number[];
  readonly styles: readonly ('normal' | 'italic')[];
  readonly subsets: readonly string[];
  /** SPDX id of the family's licence (the font allowlist: OFL-1.1 or Apache-2.0). */
  readonly license: string;
  readonly copyright: string;
};

/** Why a Google font could not be fetched. */
export type GoogleFontError = {
  readonly code: 'GOOGLE_FETCH' | 'GOOGLE_PARSE' | 'GOOGLE_URL' | 'GOOGLE_REQUEST';
  readonly message: string;
};

/** The `fetch` the studio uses (injected so tests answer it). */
export type Fetch = (
  url: string,
  init?: { headers?: { [name: string]: string } },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

/** One slice of a face: a unicode range of a weight and style, and the file that holds it. */
export type GoogleSlice = {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  readonly subset: string;
  readonly unicodeRange: string;
  readonly url: string;
};

const CSS_API = 'https://fonts.googleapis.com/css2';
/** The only host a font file is fetched from: a stylesheet naming another is refused, so a changed or hostile answer cannot send the studio elsewhere. */
const FILES = /^https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9/_.-]+\.woff2$/;
/** A user agent that gets WOFF2 slices (the API answers by agent). */
const WOFF2_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** The most files taken for one request: a few weights, two styles and a few subsets. */
const MAX_SLICES = 60;
/** The longest stylesheet read (characters) and the largest font file kept (bytes): Google's answers are far smaller. */
const MAX_SHEET = 200_000;
const MAX_FILE = 5 * 1024 * 1024;

/** The catalog in `json`, the families that are well formed (a malformed entry is left out). */
export function readCatalog(json: unknown): readonly CatalogFamily[] {
  const list = (json as { families?: unknown } | null)?.families;
  if (!Array.isArray(list)) return [];
  const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
  const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((n) => typeof n === 'string');
  return list.flatMap((entry: unknown) => {
    const f = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    return typeof f['family'] === 'string' &&
      typeof f['id'] === 'string' &&
      typeof f['license'] === 'string' &&
      isNumbers(f['weights']) &&
      isStrings(f['styles']) &&
      isStrings(f['subsets'])
      ? [
          {
            family: f['family'],
            id: f['id'],
            category: String(f['category'] ?? ''),
            weights: f['weights'],
            styles: f['styles'] as ('normal' | 'italic')[],
            subsets: f['subsets'],
            license: f['license'],
            copyright: String(f['copyright'] ?? ''),
          },
        ]
      : [];
  });
}

/** The stylesheet URL asking for `weights` and `styles` of `family`. */
export function cssUrl(family: string, weights: readonly number[], styles: readonly ('normal' | 'italic')[]): string {
  const pairs = styles.flatMap((style) => weights.map((w) => `${style === 'italic' ? 1 : 0},${w}`)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return `${CSS_API}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@${pairs.join(';')}&display=swap`;
}

/** The slices a stylesheet describes: each `@font-face` block, with the subset named in the comment before it. */
export function parseSlices(css: string): readonly GoogleSlice[] {
  const slices: GoogleSlice[] = [];
  for (const block of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const body = block[2] ?? '';
    const get = (prop: string) => new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
    const family = get('font-family')?.replace(/^['"]|['"]$/g, '');
    const weight = Number(get('font-weight'));
    const url = /url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/.exec(get('src') ?? '')?.[1];
    const style = get('font-style') === 'italic' ? 'italic' : 'normal';
    if (family === undefined || !Number.isFinite(weight) || url === undefined) continue;
    slices.push({ family, weight, style, subset: block[1] ?? '', unicodeRange: get('unicode-range') ?? '', url });
  }
  return slices;
}

/** The weights and styles asked for, kept to what the family has. */
const wanted = (family: CatalogFamily, weights: readonly number[], styles: readonly ('normal' | 'italic')[]) => ({
  weights: weights.filter((w) => family.weights.includes(w)),
  styles: styles.filter((s) => family.styles.includes(s)),
});

/** The bytes of every slice, each from fonts.gstatic.com only. */
async function downloadSlices(
  http: Fetch,
  family: CatalogFamily,
  slices: readonly GoogleSlice[],
): Promise<Result<readonly (GoogleSlice & { readonly bytes: Uint8Array })[], GoogleFontError>> {
  const out: (GoogleSlice & { readonly bytes: Uint8Array })[] = [];
  for (const slice of slices) {
    if (!FILES.test(slice.url)) return err({ code: 'GOOGLE_URL', message: `${family.family}: a font file is not at fonts.gstatic.com` });
    const file = await http(slice.url).catch(() => undefined);
    if (file === undefined || !file.ok) return err({ code: 'GOOGLE_FETCH', message: `${family.family}: a font file did not download` });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_FILE) return err({ code: 'GOOGLE_FETCH', message: `${family.family}: a font file is larger than ${MAX_FILE} bytes` });
    out.push({ ...slice, bytes });
  }
  return ok(out);
}

/**
 * Fetch the slices of `family` for `weights`, `styles` and `subsets` (default Latin): the stylesheet, then each file, as bytes ready for
 * `addFont`. GOOGLE_REQUEST for nothing to ask for, GOOGLE_FETCH when Google or the network does not answer, GOOGLE_PARSE for a stylesheet
 * with no slice we asked for, GOOGLE_URL for a file outside fonts.gstatic.com.
 */
export async function fetchGoogleFont(
  http: Fetch,
  family: CatalogFamily,
  options: { readonly weights: readonly number[]; readonly styles: readonly ('normal' | 'italic')[]; readonly subsets?: readonly string[] },
): Promise<Result<readonly (GoogleSlice & { readonly bytes: Uint8Array })[], GoogleFontError>> {
  const { weights, styles } = wanted(family, options.weights, options.styles);
  // Latin by default; a family without a Latin subset starts from its first
  const subsets = options.subsets ?? [family.subsets.includes('latin') ? 'latin' : (family.subsets[0] ?? 'latin')];
  if (weights.length === 0 || styles.length === 0)
    return err({ code: 'GOOGLE_REQUEST', message: `${family.family} has none of the weights and styles asked for` });
  const sheet = await http(cssUrl(family.family, weights, styles), { headers: { 'User-Agent': WOFF2_AGENT } }).catch(() => undefined);
  if (sheet === undefined || !sheet.ok)
    return err({ code: 'GOOGLE_FETCH', message: `Google Fonts did not answer for ${family.family}${sheet === undefined ? '' : ` (${sheet.status})`}` });
  const text = await sheet.text();
  if (text.length > MAX_SHEET) return err({ code: 'GOOGLE_PARSE', message: `the stylesheet for ${family.family} is longer than ${MAX_SHEET} characters` });
  const slices = parseSlices(text).filter((s) => s.family === family.family && subsets.includes(s.subset));
  if (slices.length === 0 || slices.length > MAX_SLICES)
    return err({ code: 'GOOGLE_PARSE', message: `the stylesheet for ${family.family} holds ${slices.length} usable slices` });
  return downloadSlices(http, family, slices);
}

/**
 * Fetch `family` and add every slice to the document as a font asset (licence and copyright of the family, the slice's range). Only the
 * Latin slice of a face is measured with recorded metrics (a table covers Latin). The asset ids, or the first thing that failed.
 */
export async function addGoogleFont(
  deps: FontLibraryDeps,
  http: Fetch,
  family: CatalogFamily,
  options: { readonly weights: readonly number[]; readonly styles: readonly ('normal' | 'italic')[]; readonly subsets?: readonly string[] },
): Promise<Result<readonly RecordId[], GoogleFontError | { readonly code: string; readonly message: string }>> {
  const fetched = await fetchGoogleFont(http, family, options);
  if (!fetched.ok) return fetched;
  const ids: RecordId[] = [];
  for (const slice of fetched.value) {
    const input: FontInput = {
      bytes: slice.bytes,
      name: `${family.id}-${slice.weight}-${slice.style}-${slice.subset}.woff2`,
      source: 'google',
      license: family.license,
      copyright: family.copyright,
      family: family.family,
      weight: slice.weight,
      style: slice.style,
      unicodeRange: slice.unicodeRange,
      measure: slice.subset === 'latin',
    };
    const added = await addFont(deps, input);
    if (!added.ok) return added;
    ids.push(added.value);
  }
  return ok(ids);
}

// the catalog file of the pack, by path: a glob, because a bundler only follows URLs it can see
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const CATALOG = import.meta.glob('../../../packs/fonts-core/catalog.json', { query: '?url', import: 'default', eager: true });

/** The catalog, fetched from where the studio serves it (when the picker opens, never at build time or in the player). A catalog that cannot be fetched is an error the picker shows, not an empty list. */
export async function loadCatalog(http: Fetch = (url) => fetch(url)): Promise<readonly CatalogFamily[]> {
  const url = Object.values(CATALOG)[0];
  if (url === undefined) throw new Error('the Google Fonts catalog is not part of this build');
  const response = await http(url);
  if (!response.ok) throw new Error(`the Google Fonts catalog could not be fetched (${response.status})`);
  return readCatalog(JSON.parse(await response.text()));
}
