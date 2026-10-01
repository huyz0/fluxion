// Creation tools (FR-EDT-003, 04 §3.2): a press, or a drag, on the canvas places a new element. A drag
// draws its box (the session's draft, shown by the overlay); a click places the tool's default size
// centred on the pointer. The element is added by one command, so one undo step; it is then selected
// and the select tool is back. The image tool first asks for the image (the session's pending pick).
import type { ReadView } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import { type AnyRecord, keyBetween, type RecordId } from '@fluxion/schema';
import type { Execute, PointerInfo } from './pointer.js';
import { DRAG_PX } from './selection.js';
import type { Session } from './session.js';
import { SELECT_TOOL, type StateNode, type Tool, type ToolCtx } from './tools.js';

/**
 * Where a new element goes: its id, screen, index (in front of everything at the screen's root) and
 * box.
 *
 * @public
 */
export type Placement = {
  /** The new element's id. */
  readonly id: RecordId;
  /** The screen it is added to. */
  readonly screenId: RecordId;
  /** Its fractional index, in front of its siblings. */
  readonly index: string;
  /** Its box, page units. */
  readonly transform: Box;
};

/**
 * What a creation tool makes: the element record for a placement.
 *
 * @public
 */
export type ElementMaker = (at: Placement) => AnyRecord;

/** The fields every new element shares. */
const placed = (at: Placement) => ({ id: at.id, type: 'element', screenId: at.screenId, index: at.index, transform: at.transform });

/**
 * A shape of the definition `defId` (the library's current item; `basic:rect` until the library panel
 * arrives).
 *
 * @public
 */
export const shapeMaker =
  (defId = 'basic:rect'): ElementMaker =>
  (at) =>
    ({ ...placed(at), kind: 'shape', defId }) as AnyRecord;

/**
 * A text box reading "Text": the basic pack's `basic:text-box` shape (FR-SHP-002, text placed freely,
 * no fill or stroke), which shape text draws, and which grows as its text does (FR-SHP-006). `kind: 'text'`
 * elements (pasted, imported, written by hand) are drawn by TextView and edited in the same inline editor.
 *
 * @public
 */
export const textMaker: ElementMaker = (at) =>
  ({
    ...placed(at),
    kind: 'shape',
    defId: 'basic:text-box',
    textFit: { mode: 'grow' },
    text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] },
  }) as AnyRecord;

/**
 * A frame.
 *
 * @public
 */
export const frameMaker: ElementMaker = (at) => ({ ...placed(at), kind: 'frame' }) as AnyRecord;

/**
 * An image of the asset `assetId`.
 *
 * @public
 */
export const imageMaker =
  (assetId: RecordId): ElementMaker =>
  (at) =>
    ({ ...placed(at), kind: 'image', assetId }) as AnyRecord;

/**
 * The box a press at `from` and a release at `to` place: the dragged box (shift keeps it square), or
 * for a click (under `DRAG_PX` canvas px at zoom `z`) the default `size` centred on `from`. An axis
 * dragged less than `DRAG_PX` takes the default size along it, so no element is placed flat.
 *
 * @public
 */
export function dragBox(from: Vec2, to: Vec2, size: { readonly w: number; readonly h: number }, drag: { readonly z: number; readonly shift: boolean }): Box {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) * drag.z < DRAG_PX) return { x: from.x - size.w / 2, y: from.y - size.h / 2, w: size.w, h: size.h };
  const dragged = (d: number) => Math.abs(d) * drag.z >= DRAG_PX;
  const along = (d: number, fallback: number) => (dragged(d) ? Math.abs(d) : fallback);
  // a box dragged backwards along an axis ends at the press; an axis not dragged starts there
  const start = (p: number, d: number, side: number) => (d < 0 && (drag.shift || dragged(d)) ? p - side : p);
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const w = drag.shift ? side : along(dx, size.w);
  const h = drag.shift ? side : along(dy, size.h);
  return { x: start(from.x, dx, w), y: start(from.y, dy, h), w, h };
}

/** The index in front of every element at the root of `screen`; undefined for a malformed sibling index. */
export function frontIndex(view: ReadView, screen: RecordId): string | undefined {
  const indexes = view
    .members('byScreen', screen)
    .map((id) => view.get(id) as { readonly parentId?: unknown; readonly index?: unknown })
    .filter((r) => r.parentId === undefined)
    .map((r) => String(r.index))
    .sort();
  const next = keyBetween(indexes.at(-1) ?? null, null);
  return next.ok ? next.value : undefined;
}

/**
 * What adding an element needs: the document, the screen, fresh ids, the command runner and the
 * session to select it in.
 *
 * @public
 */
export type CreateDeps = {
  /** The document, to read. */
  readonly view: ReadView;
  /** The screen to add to; nothing is added without one. */
  readonly screen: RecordId | undefined;
  /** A fresh record id. */
  newId(): RecordId;
  /** Run a command. */
  readonly execute: Execute;
  /** Close the undo step. */
  seal(): void;
  /** The session: the new element is selected, and the select tool is back. */
  readonly session: Session;
};

/**
 * Add the element `make` makes at `box` on the deps' screen, in one command (one undo step), select
 * it and go back to the select tool. The new id, or undefined when nothing was added.
 *
 * @public
 */
export function createElement(deps: CreateDeps, box: Box, make: ElementMaker): RecordId | undefined {
  const index = deps.screen === undefined ? undefined : frontIndex(deps.view, deps.screen);
  if (deps.screen === undefined || index === undefined) return undefined;
  const id = deps.newId();
  const r = deps.execute('element.create', { element: make({ id, screenId: deps.screen, index, transform: box }) });
  // tzap disable next-line CallExpression: element.create has no merge key, so its step is closed anyway; sealed like every tool write
  deps.seal();
  if (!r.ok) return undefined;
  deps.session.selection.set([id]);
  deps.session.tool.set(SELECT_TOOL);
  return id;
}

/**
 * A creation tool: its id, name, shortcut and default size, and what it does with the box placed.
 *
 * @public
 */
export type CreationSpec = {
  /** The tool's id. */
  readonly id: string;
  /** Its name. */
  readonly title: string;
  /** Its key. */
  readonly shortcut: string;
  /** The size a click places, page units. */
  readonly size: {
    /** Width. */
    readonly w: number;
    /** Height. */
    readonly h: number;
  };
  /** Given the box placed: add the element (the default), or leave it to a picker. */
  place(ctx: ToolCtx, box: Box): void;
};

/** The spec's `sizing` state: the draft follows the pointer; the release places the box. */
function sizing(spec: CreationSpec, from: { at: Vec2 }): StateNode {
  const box = (ctx: ToolCtx, e: PointerInfo) => dragBox(from.at, e.page, spec.size, { z: ctx.session.camera.get().z, shift: e.shift });
  return {
    id: 'sizing',
    onPointerMove: (ctx, e) => {
      ctx.session.draft.set(box(ctx, e));
      return undefined;
    },
    onPointerUp: (ctx, e) => {
      ctx.session.draft.set(undefined);
      spec.place(ctx, box(ctx, e));
      return { to: 'idle' };
    },
    onCancel: (ctx) => {
      ctx.session.draft.set(undefined);
      return { to: 'idle' };
    },
  };
}

/**
 * The tool of `spec`: a primary press starts a box; the release places it.
 *
 * @public
 */
export function creationTool(spec: CreationSpec): Tool {
  const from = { at: { x: 0, y: 0 } };
  return {
    id: spec.id,
    title: spec.title,
    shortcut: spec.shortcut,
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerDown: (_ctx, e) => {
          if (e.button !== 0) return undefined;
          from.at = e.page;
          return { to: 'sizing' };
        },
      },
      sizing: sizing(spec, from),
    },
  };
}

/** A tool that adds what `make` makes at the box placed. */
const adding = (spec: Omit<CreationSpec, 'place'>, make: ElementMaker): Tool => creationTool({ ...spec, place: (ctx, box) => createElement(ctx, box, make) });

/**
 * The shape tool (R): a `basic:rect` by default.
 *
 * @public
 */
export const shapeTool = (defId = 'basic:rect'): Tool => adding({ id: 'shape', title: 'Shape', shortcut: 'r', size: { w: 160, h: 100 } }, shapeMaker(defId));

/**
 * The text tool (T).
 *
 * @public
 */
export const textTool = (): Tool => adding({ id: 'text', title: 'Text', shortcut: 't', size: { w: 200, h: 40 } }, textMaker);

/**
 * The frame tool (F).
 *
 * @public
 */
export const frameTool = (): Tool => adding({ id: 'frame', title: 'Frame', shortcut: 'f', size: { w: 400, h: 300 } }, frameMaker);

/**
 * The image tool (I): the box placed waits in the session for the image picker.
 *
 * @public
 */
export const imageTool = (): Tool =>
  creationTool({ id: 'image', title: 'Image', shortcut: 'i', size: { w: 240, h: 160 }, place: (ctx, box) => ctx.session.imagePick.set(box) });

/**
 * The document's image assets, by name: what the image picker offers.
 *
 * @public
 */
export function imageAssets(view: ReadView): readonly { readonly id: RecordId; readonly name: string }[] {
  // the asset records only (a query over them re-runs when one of them changes, not on every edit)
  return view
    .members('byType', 'asset')
    .map((id) => view.get(id) as { readonly mime?: unknown; readonly name?: unknown } | undefined)
    .filter((r) => String(r?.mime).startsWith('image/'))
    .map((r) => ({ id: (r as unknown as { id: RecordId }).id, name: String(r?.name) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
