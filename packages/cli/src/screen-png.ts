// One screen of a document as PNG bytes (FR-AI-006, ADR-0038): what the MCP `render_screen_png` tool returns.
import { type Diagnostic, type DocumentFile, type RecordId, screenSize } from '@fluxion/schema';
import { staticPage } from './render.js';
import { type Launcher, playwrightLauncher, renderPngBytes } from './render-png.js';

/** The widest image a result carries (ADR-0038). */
const MAX_WIDTH = 2048;
/** The width of an image when none is asked for (ADR-0038). */
const DEFAULT_WIDTH = 1280;

/**
 * A rendered screen.
 *
 * @public
 */
export type ScreenImage = {
  /** The record id of the screen drawn. */
  readonly screen: string;
  /** The PNG file's bytes. */
  readonly png: Uint8Array;
  /** Pixel width of the image. */
  readonly width: number;
  /** Pixel height of the image. */
  readonly height: number;
};

/**
 * What {@link renderScreenPng} returns: the image, or the diagnostics that say why there is none.
 *
 * @public
 */
export type ScreenImageResult =
  | {
      /** The screen was drawn. */
      readonly ok: true;
      /** The image. */
      readonly value: ScreenImage;
      /** Warnings of the parse. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      /** The screen could not be drawn. */
      readonly ok: false;
      /** Why. */
      readonly diagnostics: readonly Diagnostic[];
    };

const pngSize = (png: Uint8Array): { width: number; height: number } => {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};

function firstScreen(document: DocumentFile): string | undefined {
  return Object.values(document.records)
    .filter((r) => r.type === 'screen' && (r as { hidden?: unknown }).hidden !== true)
    .sort((a, b) => ((a as { index: string }).index < (b as { index: string }).index ? -1 : 1))[0]?.id;
}

/**
 * Photographs one screen (the first visible one by default) of the document in `text` in headless Chromium. The image is no wider than
 * `width` (default 1280, at most 2048): a larger screen is scaled down, a smaller one is left at its own size. Without a browser the
 * diagnostics carry `FLX_CLI_PEER_MISSING`.
 *
 * @public
 */
export async function renderScreenPng(
  text: string,
  options: { readonly screen?: string; readonly width?: number; readonly launch?: Launcher } = {},
): Promise<ScreenImageResult> {
  const first = staticPage(text, options.screen === undefined ? undefined : [options.screen], 'the document');
  if ('exitCode' in first) return { ok: false, diagnostics: first.diagnostics };
  const screen = options.screen ?? firstScreen(first.document);
  if (screen === undefined || !first.drawn.includes(screen))
    return {
      ok: false,
      diagnostics: [{ code: 'FLX_CLI_USAGE', severity: 'error', path: '', message: 'the document has no visible screen to draw' }],
    };
  const size = screenSize(first.document.records[screen] as never);
  const width = Math.min(Math.max(1, Math.floor(options.width ?? DEFAULT_WIDTH)), MAX_WIDTH);
  const scale = Math.min(1, width / size.w);
  const png = await renderPngBytes(first.html, screen, scale, options.launch ?? playwrightLauncher);
  if (!(png instanceof Uint8Array)) return { ok: false, diagnostics: png.diagnostics };
  return { ok: true, value: { screen: screen as RecordId, png, ...pngSize(png) }, diagnostics: first.diagnostics };
}
