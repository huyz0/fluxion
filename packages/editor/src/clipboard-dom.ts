// The system clipboard (FR-EDT-007, ADR-0020, M7.22): the DOM side of the format in clipboard-format.ts. The
// keyboard copy, cut and paste go through the clipboard events' `DataTransfer` (synchronous, no permission); the
// menu commands go through the async Clipboard API, which writes everything in one `ClipboardItem` (a second write
// would wipe the first) and reads the richest representation. What comes in is untrusted: the carrier HTML is parsed
// with `DOMParser` into an inert document and only the first template's text is read.
import type { ClipboardPayload } from './clipboard.js';
import {
  CLIPBOARD_TYPE,
  MAX_PAYLOAD_CHARS,
  type ParsedPayload,
  parsePayload,
  payloadHtml,
  payloadJson,
  payloadText,
  WEB_CLIPBOARD_TYPE,
} from './clipboard-format.js';

/** The payload JSON in the first `<template data-fluxion>` of `html`, read from an inert document; undefined when there is none. */
export function templateJson(html: string): string | undefined {
  // an untrusted page's HTML is not parsed at any length: more than a payload may hold (plus its picture) is refused unread
  if (html.length > 2 * MAX_PAYLOAD_CHARS) return undefined;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector<HTMLTemplateElement>('template[data-fluxion]')?.content.textContent ?? undefined;
}

/** Put every representation of `payload` on the event's `DataTransfer`: the custom type, the HTML and the text. */
export function writeToEvent(data: DataTransfer, payload: ClipboardPayload): string {
  const json = payloadJson(payload);
  data.setData(CLIPBOARD_TYPE, json);
  data.setData('text/html', payloadHtml(payload, json));
  data.setData('text/plain', payloadText(payload));
  return json;
}

/** The payload on a paste event's `DataTransfer`: the custom type first, then the HTML template; undefined when neither holds one. */
export function readFromEvent(data: DataTransfer): { readonly json: string; readonly parsed: ParsedPayload } | undefined {
  const custom = data.getData(CLIPBOARD_TYPE);
  const html = custom === '' ? data.getData('text/html') : '';
  const json = custom !== '' ? custom : html === '' ? undefined : templateJson(html);
  return json === undefined || json === '' ? undefined : { json, parsed: parsePayload(json) };
}

/** Whether the async Clipboard API can be used here. */
export const asyncClipboard = (): boolean => typeof navigator !== 'undefined' && navigator.clipboard !== undefined && typeof ClipboardItem !== 'undefined';

/** Whether the browser takes web custom formats in a `ClipboardItem` (Chromium). */
const supportsWeb = (): boolean => typeof ClipboardItem.supports === 'function' && ClipboardItem.supports(WEB_CLIPBOARD_TYPE);

/**
 * Write `payload` with one `navigator.clipboard.write`: the HTML, the text and, where the browser allows, the web
 * custom format. False when the browser refuses (no permission, no focus) or has no async API.
 */
export async function writeAsync(payload: ClipboardPayload): Promise<boolean> {
  if (!asyncClipboard()) return false;
  const json = payloadJson(payload);
  const blob = (type: string, text: string) => new Blob([text], { type });
  const item = new ClipboardItem({
    'text/html': blob('text/html', payloadHtml(payload, json)),
    'text/plain': blob('text/plain', payloadText(payload)),
    ...(supportsWeb() ? { [WEB_CLIPBOARD_TYPE]: blob(WEB_CLIPBOARD_TYPE, json) } : {}),
  });
  try {
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

/** `navigator.clipboard.read`, asking for the HTML unsanitised where the browser supports it (so the template survives). */
async function readItems(): Promise<ClipboardItems | undefined> {
  const read = navigator.clipboard.read.bind(navigator.clipboard) as (options?: { unsanitized?: string[] }) => Promise<ClipboardItems>;
  try {
    return await read({ unsanitized: ['text/html'] });
  } catch {
    try {
      return await read();
    } catch {
      return undefined;
    }
  }
}

/** The payload JSON an item holds: in the web custom format, else in the template of its HTML. */
async function jsonOf(item: ClipboardItem): Promise<string | undefined> {
  if (item.types.includes(WEB_CLIPBOARD_TYPE)) return (await item.getType(WEB_CLIPBOARD_TYPE)).text();
  return item.types.includes('text/html') ? templateJson(await (await item.getType('text/html')).text()) : undefined;
}

/**
 * The payload on the system clipboard through the async API (a menu Paste, which may prompt): the web custom format
 * first, then the HTML template; undefined when there is none or the browser refuses.
 */
export async function readAsync(): Promise<{ readonly json: string; readonly parsed: ParsedPayload } | undefined> {
  if (!asyncClipboard()) return undefined;
  const items = await readItems();
  for (const item of items ?? []) {
    const json = await jsonOf(item);
    if (json !== undefined && json !== '') return { json, parsed: parsePayload(json) };
  }
  return undefined;
}
