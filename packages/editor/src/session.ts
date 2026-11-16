// The editor session (ADR-0028): selection, camera, tool and hover of one open document, as core's
// writable signals. Never part of the document: nothing here is passed to `store.transact` or
// serialized; undo carries the selection through transaction meta instead (ADR-0014).
import { effect, type WritableSignal, writable } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import type { AnchorDot } from './anchor-snap.js';
import type { Camera } from './camera.js';
import type { SnapGuide } from './snap/snap.js';

/**
 * The session state of one open document.
 *
 * @public
 */
export type Session = {
  /** The document it belongs to. */
  readonly docId: string;
  /** The selected elements, in selection order. */
  readonly selection: WritableSignal<readonly RecordId[]>;
  /** Where the canvas looks. */
  readonly camera: WritableSignal<Camera>;
  /** The screen the canvas shows; undefined (or one that is gone) is the document's first screen. */
  readonly screen: WritableSignal<RecordId | undefined>;
  /** The active tool's id. */
  readonly tool: WritableSignal<string>;
  /** The element under the pointer, if any. */
  readonly hover: WritableSignal<RecordId | undefined>;
  /** The marquee being dragged, page units, if any. */
  readonly marquee: WritableSignal<Box | undefined>;
  /** The box a creation tool is being dragged out to, page units, if any. */
  readonly draft: WritableSignal<Box | undefined>;
  /** The line a tool is drawing (a connector's, a path's), page points, if any. */
  readonly sketch: WritableSignal<readonly Vec2[] | undefined>;
  /** The anchors of the element a connector end is over while connecting, page units (empty otherwise, FR-ANC-006). */
  readonly anchors: WritableSignal<readonly AnchorDot[]>;
  /** Editing, or presenting in place (F5). */
  readonly mode: WritableSignal<'edit' | 'present'>;
  /** The laser's recent positions, page points, newest last (present mode). */
  readonly laser: WritableSignal<readonly Vec2[]>;
  /** The box the image tool placed, waiting for an image to be picked, if any. */
  readonly imagePick: WritableSignal<Box | undefined>;
  /** The element whose text is being edited in place, if any. */
  readonly editing: WritableSignal<RecordId | undefined>;
  /** The text region being edited when it is not the shape's first (FR-SHP-007): its name; the first, or the text, undefined. */
  readonly editingRegion: WritableSignal<string | undefined>;
  /** The group entered to edit its members (double-click; Esc leaves it), if any: a click picks within it. */
  readonly entered: WritableSignal<RecordId | undefined>;
  /** The smart guides of a drag under way, page units (empty outside one). */
  readonly guides: WritableSignal<readonly SnapGuide[]>;
  /** The frame a drag under way would drop an element into, outlined while it would (ADR-0052); undefined otherwise. */
  readonly dropTarget: WritableSignal<RecordId | undefined>;
  /** The library's current item, a shape definition id: what the shape tool places (starts as `basic:rect`). */
  readonly library: WritableSignal<string>;
  /** Whether a drag snaps (the toolbar toggle, FR-ARR-005). */
  readonly snap: WritableSignal<boolean>;
  /** Whether snapping includes a grid (the toolbar's Grid toggle, FR-ARR-005; off to start). */
  readonly grid: WritableSignal<boolean>;
  /** The path shape whose vertices are being edited (FR-SHP-011; double-click it, Esc leaves), and its selected vertex, if any. */
  readonly pathEdit: WritableSignal<PathEditing | undefined>;
  /** The selected cells of the one selected table (FR-SHP-014; a click on a selected table picks one, shift-click extends), if any. */
  readonly tableCells: WritableSignal<TableCellRange | undefined>;
  /** The table cell whose text is being edited in place (FR-SHP-014, M19.43; double-click it, or Enter with it picked), if any. */
  readonly editingCell: WritableSignal<TableCellAt | undefined>;
  /** A quick-connect drag dropped on nothing (FR-EDT-015): where, waiting for the mini library's choice; undefined otherwise. */
  readonly quickDrop: WritableSignal<QuickDrop | undefined>;
  /** The find bar's state while it is open (FR-EDT-016; Ctrl/Cmd+F); undefined while closed. */
  readonly find: WritableSignal<FindState | undefined>;
  /** The element Copy style took the style of (FR-ARR-007), for Paste style; undefined until a style is copied. */
  readonly styleSource: WritableSignal<RecordId | undefined>;
};

/**
 * The find bar's state (FR-EDT-016).
 *
 * @public
 */
export type FindState = {
  /** What is searched for. */
  readonly query: string;
  /** The match Enter last jumped to, if any. */
  readonly current?: RecordId | undefined;
  /** Counts each opening, so that opening it again focuses it again. */
  readonly opened: number;
};

/**
 * A quick-connect drag dropped on nothing (FR-EDT-015): the connector to add, and the shape the mini library may add with it.
 *
 * @public
 */
export type QuickDrop = {
  /** The shape the drag started from. */
  readonly source: RecordId;
  /** The side of it the "+" was on. */
  readonly side: 'n' | 'e' | 's' | 'w';
  /** Where the connector starts: that side's middle, page units. */
  readonly from: Vec2;
  /** Where it was dropped, page units. */
  readonly at: Vec2;
  /** The same point on the canvas, px from its top-left (where the mini library opens). */
  readonly screen: Vec2;
};

/**
 * A cell of a table: the table and the row and column the cell starts at (a merged cell's first).
 *
 * @public
 */
export type TableCellAt = {
  /** The table. */
  readonly id: RecordId;
  /** The cell's row. */
  readonly row: number;
  /** Its column. */
  readonly col: number;
};

/**
 * The selected cells of a table: the cell first picked and the one the range reaches (the same cell for one).
 *
 * @public
 */
export type TableCellRange = {
  /** The table. */
  readonly id: RecordId;
  /** The first picked cell's row. */
  readonly row: number;
  /** Its column. */
  readonly col: number;
  /** The row the range reaches. */
  readonly toRow: number;
  /** The column it reaches. */
  readonly toCol: number;
};

/**
 * The path shape being edited and its selected vertex.
 *
 * @public
 */
export type PathEditing = {
  /** The `core:path` shape. */
  readonly id: RecordId;
  /** The selected vertex (Delete removes it): its subpath and index. */
  readonly point?:
    | {
        /** The subpath, in path order. */
        readonly sub: number;
        /** The vertex within it. */
        readonly index: number;
      }
    | undefined;
};

/**
 * The camera of a new session: page origin at the top-left, 100 %.
 *
 * @public
 */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, z: 1 };

/**
 * A fresh session for the document `docId`: nothing selected or hovered, no marquee, draft, sketch or pending
 * image, the select tool, the default camera.
 *
 * @public
 */
export function createSession(docId: string): Session {
  const session: Session = {
    docId,
    selection: writable<readonly RecordId[]>([]),
    camera: writable(DEFAULT_CAMERA),
    screen: writable<RecordId | undefined>(undefined),
    tool: writable('select'),
    hover: writable<RecordId | undefined>(undefined),
    marquee: writable<Box | undefined>(undefined),
    draft: writable<Box | undefined>(undefined),
    sketch: writable<readonly Vec2[] | undefined>(undefined),
    anchors: writable<readonly AnchorDot[]>([]),
    mode: writable<'edit' | 'present'>('edit'),
    laser: writable<readonly Vec2[]>([]),
    imagePick: writable<Box | undefined>(undefined),
    editing: writable<RecordId | undefined>(undefined),
    editingRegion: writable<string | undefined>(undefined),
    entered: writable<RecordId | undefined>(undefined),
    guides: writable<readonly SnapGuide[]>([]),
    dropTarget: writable<RecordId | undefined>(undefined),
    library: writable('basic:rect'),
    snap: writable(true),
    grid: writable(false),
    pathEdit: writable<PathEditing | undefined>(undefined),
    tableCells: writable<TableCellRange | undefined>(undefined),
    editingCell: writable<TableCellAt | undefined>(undefined),
    quickDrop: writable<QuickDrop | undefined>(undefined),
    find: writable<FindState | undefined>(undefined),
    styleSource: writable<RecordId | undefined>(undefined),
  };
  // path editing ends when its shape stops being the whole selection, however the selection changed (FR-SHP-011)
  // so does a table's cell selection (FR-SHP-014)
  effect(() => {
    const [only, ...rest] = session.selection.get();
    const editing = session.pathEdit.get();
    if (editing !== undefined && (only !== editing.id || rest.length > 0)) session.pathEdit.set(undefined);
    const cells = session.tableCells.get();
    if (cells !== undefined && (only !== cells.id || rest.length > 0)) session.tableCells.set(undefined);
    const cell = session.editingCell.get();
    if (cell !== undefined && (only !== cell.id || rest.length > 0)) session.editingCell.set(undefined);
  });
  return session;
}

/**
 * The sessions of the open documents, one per document id.
 *
 * @public
 */
export type Sessions = {
  /** The session of `docId`, created on first use. */
  get(docId: string): Session;
  /** Forget the session of `docId` (its document closed); the next `get` starts afresh. */
  drop(docId: string): void;
};

/**
 * An empty set of sessions.
 *
 * @public
 */
export function createSessions(): Sessions {
  const open = new Map<string, Session>();
  return {
    get: (docId) => {
      const known = open.get(docId);
      if (known) return known;
      const session = createSession(docId);
      open.set(docId, session);
      return session;
    },
    drop: (docId) => {
      open.delete(docId);
    },
  };
}
