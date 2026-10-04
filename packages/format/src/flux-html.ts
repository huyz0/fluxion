// The `.flux.html` writer (FR-FIL-002, FR-EXP-001, NFR-SEC-002; architecture/08 §3): one HTML file that holds the `.flux` archive and the
// player that draws it, opens from `file://` with the network off, and runs under a CSP that names its two scripts by SHA-256. The archive
// is a data block (never executed), the player is the classic script built by `@fluxion/player-inline` (ADR-0154), and a static boot script
// hands the archive's bytes to `Fluxion.start`. Both re-import markers sit in the first 4 kB so a reader finds the archive by scanning text.
import { err, ok, type Result } from '@fluxion/schema';
import { encodeBase64 } from './base64.js';
import type { ContentHasher, FluxWriteFailure } from './flux-writer.js';
import { sanitizeSvg } from './sanitize-svg.js';
import { encodeUtf8 } from './utf8.js';

/**
 * What to write.
 *
 * @public
 */
export type WriteFluxHtmlInput = {
  /** The `.flux` archive to embed, as `writeFlux` made it. */
  readonly flux: Uint8Array;
  /** The player: the classic script `@fluxion/player-inline` builds (`dist/player.inline.js`), which defines the global `Fluxion`. */
  readonly playerScript: string;
  /** The document's title, for the page. */
  readonly title: string;
  /** The language of the page (a BCP 47 tag; default `en`). */
  readonly lang?: string;
  /** Who made the file, for the `generator` meta (for example `fluxion 1.4.0`). */
  readonly generator?: string;
  /** An SVG of the first screen, shown where scripts are off; it goes through `sanitizeSvg` and is left out when that refuses it. */
  readonly noscriptSvg?: string;
  /** Hashes the scripts for the CSP and the archive for the data block. */
  readonly hasher: ContentHasher;
};

/**
 * The first marker a reader looks for in the first 4 kB.
 *
 * @public
 */
export const FLUX_HTML_MARKER_META = '<meta name="fluxion:format" content="1.0">';
/**
 * The second marker, a comment at the start of the body.
 *
 * @public
 */
export const FLUX_HTML_MARKER_COMMENT = '<!-- fluxion:package v1 -->';

const MAX_TITLE = 200;
/** Longest `generator` and language tag written: both come before the re-import markers, which must stay in the first 4 kB. */
const MAX_GENERATOR = 200;
const MAX_LANG = 35;
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/** The loading state and the layout of the no-script fallback: small, and the only style in the file. */
const STYLE =
  'html,body{margin:0;height:100%;background:#000;color:#ddd;font:16px system-ui,sans-serif}#fluxion-root{position:fixed;inset:0}noscript{display:block;padding:1rem}noscript svg{max-width:100%;height:auto;background:#fff}';

/**
 * The boot script: reads the archive from its data block, decodes the base64 (natively where the engine can) and hands the bytes to the
 * player. A failure is a line of text in the page. It is static, so every file carries the same one and the same CSP hash for it.
 *
 * @public
 */
export const FLUX_HTML_BOOT =
  "(function(){var r=document.getElementById('fluxion-root');function say(m){r.textContent=m}try{var t=document.getElementById('fluxion-package').textContent.trim();var b=Uint8Array.fromBase64?Uint8Array.fromBase64(t):Uint8Array.from(atob(t),function(c){return c.charCodeAt(0)});Fluxion.start(b,r).then(function(x){if(!x.ok)say(x.message)},function(e){say('This file cannot be shown: '+e)})}catch(e){say('This file cannot be shown: '+e)}})();";

/** `text` safe inside an HTML text node or a double-quoted attribute. */
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * `script` as the HTML parser will read it, and safe inside a `<script>` element: line ends are LF and a NUL is U+FFFD (the parser normalises both before
 * the CSP hashes the text), and an end tag or a comment opener would end or hide the block, so they are written `<\/script` and `<\!--`.
 */
const scriptSafe = (script: string): string =>
  script
    .replace(/\r\n?/g, '\n')
    .replaceAll('\0', '\ufffd')
    .replace(/<\/(script)/gi, '<\\/$1')
    .replace(/<!--/g, '<\\!--');

/** The `sha256-…` CSP source (base64 of the raw digest) of `text`, from the hex digest the hasher gives. */
async function cspHash(hasher: ContentHasher, text: string): Promise<string> {
  const hex = await hasher.sha256(encodeUtf8(text));
  const raw = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
  return `'sha256-${encodeBase64(raw)}'`;
}

/** The Content-Security-Policy of a `.flux.html`: nothing but its two scripts (by hash) and `blob:`/`data:` media; no network, no frames of other origins. */
const csp = (boot: string, player: string): string =>
  `default-src 'none'; script-src ${boot} ${player} blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;

/**
 * Write `input` as a `.flux.html`: the archive as base64 in a data block, the player and the boot script inline, a CSP that names both
 * scripts, and both re-import markers in the first 4 kB. The same input gives the same text. A failure is a `reason`.
 *
 * @public
 */
export async function writeFluxHtml(input: WriteFluxHtmlInput): Promise<Result<string, FluxWriteFailure>> {
  if (input.playerScript.trim() === '') return err({ reason: 'the player script is empty', kind: 'invalid' });
  const player = scriptSafe(input.playerScript);
  const hashes = [await cspHash(input.hasher, FLUX_HTML_BOOT), await cspHash(input.hasher, player)] as const;
  const title = escapeHtml(input.title.slice(0, MAX_TITLE));
  const lang = input.lang !== undefined && input.lang.length <= MAX_LANG && LANG.test(input.lang) ? input.lang : 'en';
  const svg = input.noscriptSvg === undefined ? undefined : sanitizeSvg(input.noscriptSvg);
  const archiveHash = await input.hasher.sha256(input.flux);
  const noscript = `<noscript>${svg ?? ''}<p>This presentation needs JavaScript.</p></noscript>`;
  const head = [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<meta http-equiv="Content-Security-Policy" content="${csp(hashes[0], hashes[1])}">`,
    ...(input.generator === undefined ? [] : [`<meta name="generator" content="${escapeHtml(input.generator.slice(0, MAX_GENERATOR))}">`]),
    FLUX_HTML_MARKER_META,
    `<title>${title}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    FLUX_HTML_MARKER_COMMENT,
    '<div id="fluxion-root"></div>',
    noscript,
    `<script type="application/octet-stream" id="fluxion-package" data-encoding="base64" data-sha256="${archiveHash}">${encodeBase64(input.flux)}</script>`,
    `<script id="fluxion-player">${player}</script>`,
    `<script id="fluxion-boot">${FLUX_HTML_BOOT}</script>`,
    '</body>',
    '</html>',
    '',
  ];
  return ok(head.join('\n'));
}
