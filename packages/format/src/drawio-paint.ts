// Shared SVG writing for draw.io conversion: numbers, escaping, colors and label text. The output is plain SVG
// markup that the single-SVG importer sanitizes and witnesses again; nothing here is trusted as checked paint.

/** A conversion refusal reason for one entry. */
export class Unsupported extends Error {}
/** Refuse the current entry. */
export const refuse = (reason: string): never => {
  throw new Unsupported(reason);
};

/** Library-wide conversion budget: decoded and converted characters, and bounded conversion steps (ADR-0049). */
export type Budget = { left: number; steps: number };
/** Charge `count` conversion steps (route points walked, placeholder lookups); the overrunning entry is refused. */
export const step = (budget: Budget, count: number): void => {
  budget.steps -= count;
  if (budget.steps < 0) refuse('library-work-limit: conversion steps exhausted');
};

/** Converted SVG markup, charged per append so amplifying input is refused before it is built. */
export class Sink {
  private chars = 0;
  private readonly max: number;
  readonly parts: string[] = [];
  constructor(max: number) {
    this.max = max;
  }
  push(markup: string): void {
    this.chars += markup.length;
    if (this.chars > this.max) refuse('library-work-limit: converted SVG exceeds the entry or library budget');
    this.parts.push(markup);
  }
}

/** Label bounds before any splitting or markup: raw (HTML) text, plain text and explicit lines. */
const MAX_RAW_LABEL = 64 * 1024;
const MAX_LABEL_CHARS = 4096;
const MAX_LABEL_LINES = 64;

/** `n` as compact SVG number text. */
export const num = (n: number): string => {
  if (!Number.isFinite(n)) refuse('invalid-number');
  const r = Math.round(n * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

/** `text` escaped for SVG text content or a double-quoted attribute. */
const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** A literal hex color or `none`; anything else (named theme colors, `default`, references) is the fallback. */
export const color = (value: string | undefined, fallback: string): string => (value !== undefined && (HEX.test(value) || value === 'none') ? value : fallback);

/** A finite number from attribute text, the fallback when absent; refuses malformed numbers. */
export function numberOf(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : refuse('invalid-number');
}

export type Label = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly align: string;
  readonly valign: string;
  readonly size: number;
  readonly color: string;
};

/**
 * One label as `<text>` lines: explicit line breaks only (no font metrics in pure code, so no wrapping); the host's
 * default face renders it, so no family/weight is written (the font contract refuses faces the host lacks).
 */
export function labelSvg(label: Label): string {
  if (label.text.length > MAX_LABEL_CHARS) refuse(`label exceeds ${MAX_LABEL_CHARS} characters`);
  const lines = label.text.split('\n').map((l) => l.trim());
  if (lines.length > MAX_LABEL_LINES) refuse(`label exceeds ${MAX_LABEL_LINES} lines`);
  while (lines.length && lines.at(-1) === '') lines.pop();
  if (!lines.some((l) => l !== '') || label.color === 'none') return '';
  const lh = label.size * 1.2;
  const { anchor, x } = horizontal(label);
  const first = firstBaseline(label, lh * (lines.length - 1));
  // one text element per line: the checked text profile has no tspan and only printable ASCII
  return lines
    .map(
      (l, i) =>
        `<text x="${num(x)}" y="${num(first + i * lh)}" text-anchor="${anchor}" font-size="${num(label.size)}" fill="${label.color}" stroke="none">${escapeXml(asciiOnly(l))}</text>`,
    )
    .join('');
}

function horizontal(label: Label): { anchor: string; x: number } {
  if (label.align === 'left') return { anchor: 'start', x: label.x + 2 };
  if (label.align === 'right') return { anchor: 'end', x: label.x + label.w - 2 };
  return { anchor: 'middle', x: label.x + label.w / 2 };
}

function firstBaseline(label: Label, block: number): number {
  if (label.valign === 'top') return label.y + label.size + 2;
  if (label.valign === 'bottom') return label.y + label.h - 2 - block;
  return label.y + label.h / 2 - block / 2 + label.size * 0.35;
}

/** `text` with characters outside printable ASCII replaced by `?` (the checked text profile, ADR-0187). */
const asciiOnly = (text: string): string => text.replace(/[^\x20-\x7e]/g, '?');

/** Plain text of a draw.io HTML label: tags dropped, block breaks kept as newlines, references decoded. */
export function plainLabel(value: string, html: boolean): string {
  if (value.length > MAX_RAW_LABEL) refuse(`label exceeds ${MAX_RAW_LABEL} characters`);
  if (!html) return value;
  const broken = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, '\n');
  // `[^<>]` keeps the scan linear: an unclosed `<` stops at the next `<` instead of rescanning to the end
  const stripped = broken.replace(/<[^<>]*>/g, '');
  return stripped.replace(/&nbsp;/g, ' ').replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (all, body: string) => {
    if (!body.startsWith('#')) return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[body] ?? all;
    const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
