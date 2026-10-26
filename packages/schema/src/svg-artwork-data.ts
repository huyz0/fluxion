import { isCssColor, type TokenRef } from './paint.js';
import { SVG_POLICY_LIMITS } from './svg-policy.js';

/** An inert SVG element; children are elements or literal text, never HTML. @public */
export type SvgArtworkNode = {
  /** An element from the shared SVG allowlist. */
  readonly name: string;
  /** Decoded SVG attribute values, validated before rendering. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Ordered paint elements and text. */
  readonly children: readonly (SvgArtworkNode | string)[];
};

/** Imported paint in its own viewport, independent of the routing outline. @public */
export type SvgArtwork = {
  /** Finite local coordinates and positive extent. */
  readonly viewBox: {
    /** Left coordinate in authored units. */
    readonly x: number;
    /** Top coordinate in authored units. */
    readonly y: number;
    /** Positive horizontal extent. */
    readonly width: number;
    /** Positive vertical extent. */
    readonly height: number;
  };
  /** The root paint element. */
  readonly root: SvgArtworkNode;
  /** Optional literal-color to theme-token mapping; unresolved tokens retain the literal. */
  readonly colors?: Readonly<Record<string, TokenRef>>;
};

// Inspect descriptors before reading values: direct callers must supply plain JSON data.
function fields(value: object): unknown[] | undefined {
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
  if (Object.getOwnPropertySymbols(value).length) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length > SVG_POLICY_LIMITS.maxNodes * 4) return undefined;
  const result: unknown[] = [];
  for (const key of keys) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return undefined;
    result.push(key, descriptor.value);
  }
  return result;
}

function arrayValues(value: unknown[]): unknown[] | undefined {
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length > SVG_POLICY_LIMITS.maxNodes * 4) return undefined;
  if (Reflect.ownKeys(value).length !== value.length + 1) return undefined;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !('value' in descriptor)) return undefined;
    result.push(descriptor.value);
  }
  return result;
}

type Step = { readonly value: unknown; readonly depth: number };
type Budget = { chars: number; readonly seen: Set<object> };

function children(value: object, budget: Budget, room: number): unknown[] | undefined {
  if (budget.seen.has(value) || budget.seen.size >= SVG_POLICY_LIMITS.maxNodes * 4) return undefined;
  budget.seen.add(value);
  const values = Array.isArray(value) ? arrayValues(value) : fields(value);
  return values && values.length <= room ? values : undefined;
}

function inspect(step: Step, budget: Budget, room: number): Step[] | undefined {
  if (step.depth > SVG_POLICY_LIMITS.maxDepth * 2 + 3) return undefined;
  const { value, depth } = step;
  budget.chars += typeof value === 'string' ? value.length : 0;
  if (budget.chars > SVG_POLICY_LIMITS.maxChars) return undefined;
  if (typeof value !== 'object' || value === null) return [];
  return children(value, budget, room)?.map((child) => ({ value: child, depth: depth + 1 }));
}

/** Bound arbitrary input before recursive schema traversal; aliases/cycles are not JSON trees. */
function boundedData(input: unknown): boolean {
  const pending: Step[] = [{ value: input, depth: 0 }];
  const budget: Budget = { chars: 0, seen: new Set() };
  while (pending.length) {
    const step = pending.pop();
    if (!step) return false;
    const next = inspect(step, budget, SVG_POLICY_LIMITS.maxNodes * 4 - pending.length);
    if (!next) return false;
    for (let i = next.length - 1; i >= 0; i--) {
      const child = next[i];
      if (child) pending.push(child);
    }
  }
  return true;
}

function appendPaintChildren(step: Step, pending: Step[], remaining: number): boolean {
  if (!step.value || typeof step.value !== 'object') return true;
  const { children: values } = step.value as Record<string, unknown>;
  if (!Array.isArray(values)) return true;
  if (values.length > remaining) return false;
  for (const value of values) pending.push({ value, depth: typeof value === 'string' ? step.depth : step.depth + 1 });
  return true;
}

/** After descriptor preflight, enforce paint-node counts before the recursive schema. */
function boundedPaint(input: unknown): boolean {
  if (!input || typeof input !== 'object') return true;
  const { root } = input as Record<string, unknown>;
  const pending: Step[] = [{ value: root, depth: 1 }];
  let count = 0;
  while (pending.length) {
    const step = pending.pop();
    if (!step || ++count > SVG_POLICY_LIMITS.maxNodes || step.depth > SVG_POLICY_LIMITS.maxDepth) return false;
    if (!appendPaintChildren(step, pending, SVG_POLICY_LIMITS.maxNodes - count - pending.length)) return false;
  }
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function nodeData(input: unknown): boolean {
  const pending = [input];
  while (pending.length) {
    const node = pending.pop();
    if (!record(node) || !onlyKeys(node, ['name', 'attributes', 'children'])) return false;
    const { name, attributes, children } = node;
    if (typeof name !== 'string' || !record(attributes) || !Array.isArray(children)) return false;
    if (!Object.values(attributes).every((value) => typeof value === 'string')) return false;
    pending.push(...children.filter((child) => typeof child !== 'string'));
  }
  return true;
}
function viewportData(input: unknown): boolean {
  if (!record(input) || !onlyKeys(input, ['x', 'y', 'width', 'height'])) return false;
  const { x, y, width, height } = input;
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) && Number(width) > 0 && Number(height) > 0;
}
function colorsData(input: unknown): boolean {
  if (input === undefined) return true;
  return (
    record(input) &&
    Object.entries(input).every(([key, value]) => isCssColor(key) && typeof value === 'string' && /^\{[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\}$/.test(value))
  );
}

/** Check bounded artwork structure without loading a schema runtime into the player. Core checks semantics. @public */
export function isSvgArtworkData(input: unknown): input is SvgArtwork {
  if (!boundedData(input) || !boundedPaint(input) || !record(input) || !onlyKeys(input, ['viewBox', 'root', 'colors'])) return false;
  const { viewBox, root, colors } = input;
  return viewportData(viewBox) && nodeData(root) && colorsData(colors);
}
