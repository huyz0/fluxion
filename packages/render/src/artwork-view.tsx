// Validated imported paint (FR-LIB-004). React owns every node; no markup parser is used.
import { parseSvgArtwork, type ShapeDef } from '@fluxion/core';
import type { SvgArtwork, SvgArtworkNode } from '@fluxion/schema';
import { checkedSvgAttribute, isCssColor } from '@fluxion/schema';
import { colorResolver, type Theme, tokenPath } from '@fluxion/theme';
import { type CSSProperties, createElement, type ReactNode, useMemo } from 'react';

const PAINT = new Set(['fill', 'stroke', 'stop-color']);
const URL = /url\(\s*(['"]?)#([A-Za-z_][\w.:-]*)\1\s*\)/gi;
const property = (name: string): string => (name === 'class' ? 'className' : name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()));
type Context = { readonly ids: Map<string, string>; readonly colors: ReadonlyMap<string, string> };

function identifiers(root: SvgArtworkNode, prefix: string): Map<string, string> {
  const ids = new Map<string, string>();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    const { id } = node.attributes;
    if (id !== undefined) ids.set(id.trim(), `${prefix}-${ids.size}`);
    for (const child of node.children) if (typeof child !== 'string') pending.push(child);
  }
  return ids;
}

function colors(artwork: SvgArtwork, theme: Theme): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const resolve = colorResolver(theme);
  for (const [literal, ref] of Object.entries(artwork.colors ?? {})) {
    const path = tokenPath(ref);
    const resolved = resolve(path);
    if (resolved.ok && isCssColor(resolved.value)) result.set(literal, `var(--fx-${path.split('.').join('-')}, ${literal})`);
  }
  return result;
}

function paintValue(name: string, value: string, context: Context): string {
  if (name === 'id') return context.ids.get(value) ?? value;
  if (name === 'href') return `#${context.ids.get(value.slice(1)) ?? ''}`;
  const scoped = value.replace(URL, (_match, _quote: string, id: string) => `url(#${context.ids.get(id) ?? ''})`);
  return PAINT.has(name) ? (context.colors.get(scoped) ?? scoped) : scoped;
}

function styleOf(value: string, context: Context): CSSProperties {
  const properties: Record<string, string> = {};
  for (const declaration of value.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim();
    properties[property(name)] = paintValue(name, declaration.slice(colon + 1).trim(), context);
  }
  return properties;
}

function painted(node: SvgArtworkNode | string, key: string, context: Context): ReactNode {
  if (typeof node === 'string') return node;
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attributes)) {
    const checked = checkedSvgAttribute(node.name, name, value);
    if (!checked) continue; // The caller validates the entire tree before this component runs.
    props[property(checked.name)] = checked.name === 'style' ? styleOf(checked.value, context) : paintValue(checked.name, checked.value, context);
  }
  return createElement(
    node.name,
    props,
    node.children.map((child, index) => painted(child, `${key}.${index}`, context)),
  );
}

/** Actual element size must not overflow the validated source viewport's fit. */
export function artworkFits(artwork: SvgArtwork, w: number, h: number): boolean {
  const { x, y, width, height } = artwork.viewBox;
  return [w / width, h / height, (x * w) / width, (y * h) / height].every(Number.isFinite);
}

/** Paint already validated by ShapeView, with local references isolated per mounted instance. */
export function ArtworkView(props: {
  readonly artwork: SvgArtwork;
  readonly prefix: string;
  readonly w: number;
  readonly h: number;
  readonly theme: Theme;
}): ReactNode {
  const { artwork, prefix, w, h, theme } = props;
  const { x, y, width, height } = artwork.viewBox;
  const context = { ids: identifiers(artwork.root, prefix), colors: colors(artwork, theme) };
  return (
    <svg aria-hidden="true" className="fx-artwork" width={w} height={h} viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="none">
      {painted(artwork.root, 'root', context)}
    </svg>
  );
}

/** Undefined uses legacy paint; false marks invalid manually registered artwork. */
export function useArtwork(
  def: ShapeDef | undefined,
  size: { readonly w: number; readonly h: number },
  prefix: string,
  theme: Theme,
): ReactNode | false | undefined {
  const { w, h } = size;
  const parsed = useMemo(() => (def?.artwork === undefined ? undefined : parseSvgArtwork(def.artwork)), [def]);
  if (parsed === undefined) return undefined;
  if (!parsed.ok || !artworkFits(parsed.value, w, h)) return false;
  return <ArtworkView artwork={parsed.value} prefix={prefix} w={w} h={h} theme={theme} />;
}
