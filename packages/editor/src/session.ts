// The editor session (ADR-0028): selection, camera, tool and hover of one open document, as core's
// writable signals. Never part of the document: nothing here is passed to `store.transact` or
// serialized; undo carries the selection through transaction meta instead (ADR-0014).
import { type WritableSignal, writable } from '@fluxion/core';
import type { Box, Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import type { Camera } from './camera.js';

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
  /** Editing, or presenting in place (F5). */
  readonly mode: WritableSignal<'edit' | 'present'>;
  /** The laser's recent positions, page points, newest last (present mode). */
  readonly laser: WritableSignal<readonly Vec2[]>;
  /** The box the image tool placed, waiting for an image to be picked, if any. */
  readonly imagePick: WritableSignal<Box | undefined>;
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
  return {
    docId,
    selection: writable<readonly RecordId[]>([]),
    camera: writable(DEFAULT_CAMERA),
    tool: writable('select'),
    hover: writable<RecordId | undefined>(undefined),
    marquee: writable<Box | undefined>(undefined),
    draft: writable<Box | undefined>(undefined),
    sketch: writable<readonly Vec2[] | undefined>(undefined),
    mode: writable<'edit' | 'present'>('edit'),
    laser: writable<readonly Vec2[]>([]),
    imagePick: writable<Box | undefined>(undefined),
  };
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
