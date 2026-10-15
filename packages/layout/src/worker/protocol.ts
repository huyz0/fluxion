// The messages between the layout host (main thread) and a layout worker (ADR-0033). Everything in them is structured-clone data: no functions,
// no class instances, so a message can cross a worker boundary, a Node `worker_threads` port or a test double alike.
import type { LayoutError } from '../errors.js';
import type { OverlapOptions } from '../overlap.js';
import type { PostPassId } from '../passes.js';
import type { LaidOut, LayoutInput } from '../types.js';

/**
 * A request to lay out, sent to the worker: the algorithm by registered name, with everything `layoutSync` needs.
 *
 * @public
 */
export type LayoutJobMessage = {
  /** Discriminator. */
  readonly type: 'layout';
  /** The job number the reply carries. */
  readonly id: number;
  /** The revision of the scope this job was asked at; the host drops the result of an older one. */
  readonly revision: number;
  /** The registered algorithm name (`layered`, `grid`, ...). */
  readonly algorithm: string;
  /** The algorithm's options as written. */
  readonly options?: unknown;
  /** The nodes, edges, frame and scope. */
  readonly input: LayoutInput;
  /** The seed of the random stream. */
  readonly seed: number;
  /** A hash of the fonts the sizes were measured with. */
  readonly fontHash: string;
  /** The post-passes to run. */
  readonly post: readonly PostPassId[];
  /** Options of the overlap pass. */
  readonly overlap?: OverlapOptions;
};

/**
 * Asks the worker to forget a job. A worker busy in a synchronous layout cannot read it; the host ends such a worker instead (ADR-0033).
 *
 * @public
 */
export type LayoutCancelMessage = {
  /** Discriminator. */
  readonly type: 'cancel';
  /** The job to drop. */
  readonly id: number;
};

/**
 * What the worker answers to a job: the result, or why there is none.
 *
 * @public
 */
export type LayoutReplyMessage =
  | {
      /** Discriminator. */
      readonly type: 'done';
      /** The job this answers. */
      readonly id: number;
      /** The boxes, metrics and fingerprint. */
      readonly output: LaidOut;
    }
  | {
      /** Discriminator. */
      readonly type: 'error';
      /** The job this answers. */
      readonly id: number;
      /** Why the layout failed. */
      readonly error: LayoutError;
    };
