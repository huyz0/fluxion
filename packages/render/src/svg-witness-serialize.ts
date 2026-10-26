import type { SvgPaintRequest } from '@fluxion/format';
import type { SvgArtworkNode } from '@fluxion/schema';
import { colorResolver, toCssVars, tokenPath } from '@fluxion/theme';
import { binaryData, quotedFamily, type WitnessFrame } from './svg-witness-frame.js';
import type { PaintContext, WitnessContext } from './svg-witness-input.js';

const TEXT = ['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-rendering'];
const MAX_MARKUP = 16 * 1024 * 1024;
/** Conservative escape/UTF-8 bound before XMLSerializer, font base64 or markup copies. */
function nodeBound(node: SvgArtworkNode): number {
  const attributes = Object.entries(node.attributes).reduce((size, [name, value]) => size + 64 + (name.length + value.length) * 18, 0);
  const text = node.children
    .filter((c): c is string => typeof c === 'string')
    .reduce((size, child) => size + (/[^\x20-\x7e]/.test(child) ? Infinity : child.length * 18), 0);
  return 256 + node.name.length * 6 + attributes + text;
}
function artworkBound(root: SvgArtworkNode): number {
  let bound = 0;
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    bound += nodeBound(node);
    for (const child of node.children) if (typeof child !== 'string') pending.push(child);
  }
  return bound;
}
export function admitsPaint(request: SvgPaintRequest, context: PaintContext): boolean {
  let bound = 65536 + JSON.stringify(context.styles).length * 18 + JSON.stringify(toCssVars(context.theme)).length * 18 + artworkBound(request.artwork.root);
  const resolve = colorResolver(context.theme);
  if (Object.values(request.artwork.colors ?? {}).some((ref) => !resolve(tokenPath(ref)).ok)) return false;
  for (const requested of request.fonts) {
    const font = context.fonts.find(
      (f) => f.sha256 === requested.sha256 && f.family === requested.family && f.weight === requested.weight && f.style === requested.style,
    );
    if (!font) return false;
    bound += 4 * Math.ceil(font.bytes.byteLength / 3) + 2048;
  }
  return bound <= MAX_MARKUP;
}
function signature(root: Element): string {
  const visit = (node: Element): unknown => ({
    name: node.localName,
    namespace: node.namespaceURI,
    attributes: [...node.attributes]
      .flatMap((a) => {
        if (a.name !== 'style' || node.localName !== 'text') return [[a.name, a.value]];
        const style = (node as SVGElement).style;
        const kept = [...style]
          .filter((k) => !TEXT.includes(k))
          .sort()
          .map((k) => [k, style.getPropertyValue(k), style.getPropertyPriority(k)]);
        return kept.length ? [[a.name, JSON.stringify(kept)]] : [];
      })
      .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
    children: [...node.childNodes].map((n) => (n.nodeType === 1 ? visit(n as Element) : [n.nodeType, n.textContent])),
  });
  return JSON.stringify(visit(root));
}
function copyContext(frame: WitnessFrame, source: SVGSVGElement, clone: SVGSVGElement): readonly unknown[] {
  const style = frame.window.getComputedStyle(source);
  for (const key of ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-rendering', 'overflow'])
    clone.style.setProperty(key, style.getPropertyValue(key));
  for (const key of style) if (key.startsWith('--fx-')) clone.style.setProperty(key, style.getPropertyValue(key));
  const originals = [...source.querySelectorAll('text')],
    copies = [...clone.querySelectorAll('text')];
  return originals.map((node, i) => {
    const computed = frame.window.getComputedStyle(node),
      target = copies[i];
    if (!target) throw Error('missing text context');
    return TEXT.map((key) => {
      const value = computed.getPropertyValue(key);
      target.style.setProperty(key, value);
      return [key, value, ''];
    });
  });
}
function fontStyle(frame: WitnessFrame, context: WitnessContext, request: SvgPaintRequest): SVGStyleElement {
  const style = frame.document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = request.fonts
    .map((requested) => {
      const font = context.fonts.find((f) => f.family === requested.family && f.sha256 === requested.sha256);
      if (!font) throw Error('missing font');
      // Firefox refuses CSSFontFaceRule descriptor mutation. Validate and serialize the
      // single family through ordinary CSSOM, then parse a rule containing only that
      // owned CSS value, generated base64 and fixed descriptors (never caller CSS).
      const declaration = frame.document.createElement('span').style;
      declaration.setProperty('font-family', quotedFamily(font.family));
      const family = declaration.getPropertyValue('font-family');
      if (!family) throw Error('invalid font family');
      const sheet = new frame.window.CSSStyleSheet();
      sheet.insertRule(
        `@font-face { font-family: ${family}; src: url(data:font/woff2;base64,${binaryData(font.bytes, frame)}) format("woff2"); font-weight: 400; font-style: normal; }`,
      );
      const rule = sheet.cssRules[0];
      if (!rule || sheet.cssRules.length !== 1) throw Error('invalid font rule');
      return rule.cssText;
    })
    .join('');
  return style;
}
export function serializeWitness(
  frame: WitnessFrame,
  source: SVGSVGElement,
  options: { readonly context: WitnessContext; readonly request: SvgPaintRequest; readonly disabled?: boolean },
): string {
  const { context, request, disabled = false } = options;
  const inner = source.firstElementChild;
  if (!inner) throw Error('missing artwork');
  const expected = signature(inner);
  const clone = source.cloneNode(true) as SVGSVGElement;
  const text = copyContext(frame, source, clone);
  if (!clone.firstElementChild || signature(clone.firstElementChild) !== expected) throw Error('context changed structure');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (disabled) clone.replaceChildren();
  else clone.prepend(fontStyle(frame, context, request));
  const markup = new frame.window.XMLSerializer().serializeToString(clone);
  if (new TextEncoder().encode(markup).length > MAX_MARKUP) throw Error('markup limit');
  if (!disabled) {
    const parsed = new frame.window.DOMParser().parseFromString(markup, 'image/svg+xml');
    const actual = [...parsed.documentElement.children].find((node) => node.localName !== 'style');
    if (!actual || signature(actual) !== expected) throw Error('serialized structure');
    const actualText = [...actual.querySelectorAll('text')].map((node) =>
      TEXT.map((key) => [key, (node as SVGElement).style.getPropertyValue(key), (node as SVGElement).style.getPropertyPriority(key)]),
    );
    if (JSON.stringify(actualText) !== JSON.stringify(text)) throw Error('serialized text context');
  }
  return markup;
}
