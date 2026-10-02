// The clipboard payload as ADR-0020 puts it on the system clipboard (M7.22): the JSON (custom type), the HTML a
// non-Fluxion app pastes as a picture (a static outline of the copied boxes, followed by the payload in a
// `<template data-fluxion>`), and the plain text (the copied labels in reading order); and the other way: a payload
// read back from untrusted text is validated like an opened file before anything of it is used. Pure, no DOM.

import type { Box } from '@fluxion/geometry';
import { plainParagraphs } from '@fluxion/render';
import { type AnyRecord, isRecordId, type RecordId, SCHEMA_VERSION, schemaForRecord } from '@fluxion/schema';
import type { ClipboardAsset, ClipboardPayload } from './clipboard.js';

/**
 * The custom type the keyboard path writes and reads (ADR-0020).
 *
 * @public
 */
export const CLIPBOARD_TYPE: string = 'application/x-fluxion+json';

/**
 * The web custom format the async path writes where `ClipboardItem.supports()` allows it (ADR-0020).
 *
 * @public
 */
export const WEB_CLIPBOARD_TYPE: string = `web ${CLIPBOARD_TYPE}`;

/**
 * The most text a payload may be before it is refused (a clipboard is untrusted input).
 *
 * @public
 */
export const MAX_PAYLOAD_CHARS: number = 32 * 1024 * 1024;

/**
 * The payload as the JSON of the custom type.
 *
 * @public
 */
export function payloadJson(payload: ClipboardPayload): string {
  return JSON.stringify(payload);
}

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Rec = AnyRecord & {
  readonly kind?: string;
  readonly parentId?: RecordId;
  readonly transform?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly text?: Parameters<typeof plainParagraphs>[0];
};

/** The outline of the copied roots as static SVG: what an app that knows no Fluxion pastes. */
function outline(payload: ClipboardPayload): string {
  const bounds: Box = payload.bounds ?? { x: 0, y: 0, w: 1, h: 1 };
  const boxes = (payload.records as readonly Rec[])
    .flatMap((r) => (r.type === 'element' && r.transform ? [r.transform] : []))
    .map((t) => `<rect x="${t.x - bounds.x}" y="${t.y - bounds.y}" width="${t.w}" height="${t.h}" fill="none" stroke="#475569"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.w}" height="${bounds.h}" viewBox="0 0 ${bounds.w} ${bounds.h}">${boxes.join('')}</svg>`;
}

/**
 * The HTML of a payload: its outline, then the payload in a template that is parsed inertly on paste.
 *
 * @public
 */
export function payloadHtml(payload: ClipboardPayload, json: string = payloadJson(payload)): string {
  return `${outline(payload)}<template data-fluxion="1">${escapeText(json)}</template>`;
}

/**
 * The text of the copied labels, one per line, in reading order (top to bottom, then left to right).
 *
 * @public
 */
export function payloadText(payload: ClipboardPayload): string {
  const placed = (payload.records as readonly Rec[]).flatMap((r) =>
    r.type === 'element' && r.transform && r.text ? [r as Rec & { transform: NonNullable<Rec['transform']> }] : [],
  );
  return [...placed]
    .sort((a, b) => a.transform.y - b.transform.y || a.transform.x - b.transform.x)
    .flatMap((r) => plainParagraphs(r.text))
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * What reading a payload gave.
 *
 * @public
 */
export type ParsedPayload = ParsedOk | ParsedRefused;

/**
 * A payload that passed validation.
 *
 * @public
 */
export type ParsedOk = {
  /** It is a payload. */
  readonly ok: true;
  /** The validated payload. */
  readonly payload: ClipboardPayload;
};

/**
 * Text that is no usable payload, and why.
 *
 * @public
 */
export type ParsedRefused = {
  /** It is not. */
  readonly ok: false;
  /** Why not. */
  readonly reason: string;
};

const fail = (reason: string): ParsedPayload => ({ ok: false, reason });
const isObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAJOR = Number(SCHEMA_VERSION.split('.')[0]);

/** Whether `a` is a valid asset of a payload: an asset record, its bytes (if any) an image `data:` URL. */
function validAsset(a: unknown): a is ClipboardAsset {
  if (!isObject(a)) return false;
  const dataUrl = a['dataUrl'];
  if (dataUrl !== undefined && !(typeof dataUrl === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(dataUrl))) return false;
  return a['type'] === 'asset' && schemaForRecord(a).schema.safeParse(a).success;
}

/** The first reason a record of a payload cannot be pasted, if any. */
function badRecord(r: unknown, ids: ReadonlySet<string>): string | undefined {
  if (!isObject(r)) return 'a record is not an object';
  if (typeof r['id'] !== 'string' || !isRecordId(r['id'])) return 'a record has no valid id';
  if (r['type'] !== 'element' && r['type'] !== 'binding') return `a ${String(r['type'])} record cannot be pasted`;
  if (!schemaForRecord(r).schema.safeParse(r).success) return `record ${r['id']} is not valid`;
  if (r['type'] === 'binding' && !(ids.has(String(r['connectorId'])) && ids.has(String(r['elementId']))))
    return `binding ${r['id']} joins elements that were not copied`;
  return undefined;
}

/** The JSON object in `raw`, or why there is none. */
function rawJson(raw: string): { readonly [key: string]: unknown } | string {
  if (raw.length > MAX_PAYLOAD_CHARS) return 'the clipboard holds too much';
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return 'not JSON';
  }
  return isObject(json) ? json : 'not a Fluxion clipboard';
}

/** Why the payload's envelope (discriminator, versions) cannot be used, if it cannot. */
function shellProblem(json: { readonly [key: string]: unknown }): string | undefined {
  if (json['fluxion'] !== 'clipboard') return 'not a Fluxion clipboard';
  if (typeof json['version'] !== 'number' || json['version'] < 1) return 'no payload version';
  const schema = String(json['schemaVersion']);
  const canonical = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(schema);
  return canonical && Number(schema.split('.')[0]) === MAJOR ? undefined : `schema ${schema} cannot be pasted here`;
}

/** Whether the parent links among `elements` (by id) loop: an element that is its own ancestor. */
function hasParentLoop(elements: readonly { readonly [key: string]: unknown }[]): boolean {
  const parentOf = new Map(elements.map((e) => [String(e['id']), typeof e['parentId'] === 'string' ? e['parentId'] : undefined] as const));
  return elements.some((e) => {
    const seen = new Set<string>();
    for (let at: string | undefined = String(e['id']); at !== undefined && parentOf.has(at); at = parentOf.get(at)) {
      if (seen.has(at)) return true;
      seen.add(at);
    }
    return false;
  });
}

/** Why the payload's records or assets cannot be pasted, if they cannot. */
function recordsProblem(records: unknown, assets: unknown = []): string | undefined {
  if (!Array.isArray(records) || records.length === 0) return 'no records';
  const elements = records.filter((r): r is { readonly [key: string]: unknown } => isObject(r) && r['type'] === 'element' && typeof r['id'] === 'string');
  const ids = new Set(elements.map((e) => String(e['id'])));
  // an element twice would be pasted twice under one name, and a parent loop would be written into the document and recurse forever
  if (ids.size !== elements.length) return 'an element appears twice';
  if (hasParentLoop(elements)) return 'elements are their own ancestors';
  for (const r of records) {
    const reason = badRecord(r, ids);
    if (reason !== undefined) return reason;
  }
  return Array.isArray(assets) && assets.every(validAsset) ? undefined : 'an asset is not valid';
}

/**
 * The payload in `raw` (text off the clipboard, so untrusted), validated like an opened file: JSON of a payload of
 * this or a newer version, a schema version of the same major, records that are elements and bindings between them,
 * every one valid by its schema (unknown fields and kinds kept), assets that are records with image `data:` URLs.
 * Nothing of a payload that fails is used.
 *
 * @public
 */
export function parsePayload(raw: string): ParsedPayload {
  const json = rawJson(raw);
  if (typeof json === 'string') return fail(json);
  const problem = shellProblem(json) ?? recordsProblem(json['records'], json['assets']);
  if (problem !== undefined) return fail(problem);
  const bounds = json['bounds'];
  return {
    ok: true,
    payload: {
      fluxion: 'clipboard',
      version: 1,
      schemaVersion: String(json['schemaVersion']),
      sourceDocId: typeof json['sourceDocId'] === 'string' ? json['sourceDocId'] : '',
      sourceScreen: typeof json['sourceScreen'] === 'string' ? (json['sourceScreen'] as RecordId) : undefined,
      records: json['records'] as AnyRecord[],
      assets: (json['assets'] ?? []) as ClipboardAsset[],
      bounds: isObject(bounds) ? (bounds as unknown as Box) : undefined,
    },
  };
}
