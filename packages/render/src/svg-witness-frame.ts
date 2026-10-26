import type { SvgPaintRequest } from '@fluxion/format';
import { toCssVars } from '@fluxion/theme';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ArtworkView } from './artwork-view.js';
import { CONTENT_CSS } from './content-css.js';
import type { PaintContext, WitnessContext } from './svg-witness-input.js';
import type { WitnessScope } from './svg-witness-lifecycle.js';

export const WITNESS_POLICY =
  "default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export type WitnessFrame = { readonly document: Document; readonly window: Window & typeof globalThis };
export function binaryData(bytes: Uint8Array, frame: WitnessFrame): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return frame.window.btoa(binary);
}
export function quotedFamily(family: string): string {
  return `"${family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
export async function createWitnessFrame(document: Document, scope: WitnessScope): Promise<WitnessFrame> {
  if (!scope.alive()) throw Error('closed witness');
  const frame = document.createElement('iframe');
  scope.own(() => {
    frame.onload = frame.onerror = null;
    frame.remove();
  });
  frame.setAttribute('data-fluxion-svg-witness', '');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1024px;height:1024px;border:0;pointer-events:none';
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(Error('frame initialization'));
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${WITNESS_POLICY}"></head><body></body></html>`;
    document.body.append(frame);
  });
  if (!scope.alive()) throw Error('closed witness');
  const child = frame.contentDocument,
    window = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!child || !window || child.querySelector('meta')?.getAttribute('content') !== WITNESS_POLICY || !window.FontFace || !window.XMLSerializer)
    throw Error('unsupported frame');
  const style = child.createElement('style');
  style.textContent = CONTENT_CSS;
  child.head.append(style);
  child.body.style.margin = '0';
  return { document: child, window };
}
export async function loadWitnessFonts(frame: WitnessFrame, request: SvgPaintRequest, context: WitnessContext, scope: WitnessScope): Promise<void> {
  for (const requested of request.fonts) {
    if (!scope.alive()) throw Error('closed witness');
    const font = context.fonts.find(
      (f) => f.family === requested.family && f.sha256 === requested.sha256 && f.weight === requested.weight && f.style === requested.style,
    );
    if (!font) throw Error('unsupported face');
    const face = new frame.window.FontFace(quotedFamily(font.family), font.bytes, { weight: '400', style: 'normal' });
    scope.own(() => frame.document.fonts.delete(face));
    frame.document.fonts.add(face);
    await face.load();
    if (!scope.alive() || face.status !== 'loaded' || !frame.document.fonts.check(`400 20px ${quotedFamily(font.family)}`, 'API')) throw Error('font load');
  }
}
function sameFamily(actual: string, expected: string, family: string): boolean {
  if (actual === expected) return true;
  const reserved = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'emoji',
    'math',
    'fangsong',
    'inherit',
    'initial',
    'unset',
    'revert',
    'revert-layer',
  ]);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(family) || reserved.has(family.toLowerCase())) return false;
  const forms = [family, quotedFamily(family)];
  return forms.includes(actual) && forms.includes(expected);
}
function checkedText(frame: WitnessFrame, artwork: SVGSVGElement, request: SvgPaintRequest): void {
  const probe = frame.document.createElement('span');
  frame.document.body.append(probe);
  try {
    for (const text of artwork.querySelectorAll('text')) {
      const face = request.fonts.find((f) => f.family === text.getAttribute('font-family'));
      if (!face) throw Error('missing text face');
      probe.style.fontFamily = quotedFamily(face.family);
      probe.style.fontWeight = String(face.weight);
      probe.style.fontStyle = face.style;
      const expected = frame.window.getComputedStyle(probe),
        actual = frame.window.getComputedStyle(text);
      if (
        !sameFamily(actual.fontFamily, expected.fontFamily, face.family) ||
        actual.fontWeight !== expected.fontWeight ||
        actual.fontStyle !== expected.fontStyle
      )
        throw Error('text face mismatch');
    }
  } finally {
    probe.remove();
  }
}
export function mountWitness(frame: WitnessFrame, request: SvgPaintRequest, context: PaintContext, scope: WitnessScope): SVGSVGElement {
  if (!scope.alive()) throw Error('closed witness');
  const host = frame.document.createElement('div');
  host.className = 'fx-el';
  host.style.width = `${request.width}px`;
  host.style.height = `${request.height}px`;
  for (const [name, value] of Object.entries(context.styles)) host.style.setProperty(name, value);
  for (const [name, value] of Object.entries(toCssVars(context.theme))) host.style.setProperty(name, value);
  frame.document.body.append(host);
  const root = createRoot(host);
  scope.own(() => {
    root.unmount();
    host.remove();
  });
  flushSync(() =>
    root.render(
      createElement(
        'svg',
        { width: request.width, height: request.height, viewBox: `0 0 ${request.width} ${request.height}` },
        createElement(ArtworkView, { artwork: request.artwork, prefix: 'witness', w: request.width, h: request.height, theme: context.theme }),
      ),
    ),
  );
  const artwork = host.querySelector<SVGSVGElement>('.fx-artwork');
  if (!artwork) throw Error('missing mounted artwork');
  checkedText(frame, artwork, request);
  return artwork;
}
