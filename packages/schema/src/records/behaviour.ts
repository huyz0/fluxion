// Behaviour records (02-document-model §2, 07-animation-and-interaction §2): `timeline`, `step`,
// `interaction`, `variable` and `comment`. M2 fixes their envelopes; animation, trigger and action
// payloads are open objects typed by `type`/`kind`, checked by `anim` and `player` (M21-M25).
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { IndexKey } from '../fractional-index.js';
import type { RecordId } from '../ids.js';
import { type Extensible, indexKeySchema, type Meta, metaSchema, recordIdSchema } from '../primitives.js';

/**
 * An open payload discriminated by `kind` (step triggers, interaction triggers and actions).
 *
 * @public
 */
export type Tagged = Extensible<{
  /** What this payload is, e.g. `onClick` or `goToScreen`. */
  readonly kind: string;
}>;

/**
 * One animation of a step; its fields beyond `id` are defined by `@fluxion/anim` (M21).
 *
 * @public
 */
export type StepAnimation = Extensible<{
  /** Animation id, unique in the step. */
  readonly id: string;
}>;

/**
 * An ordered sequence of steps on a screen (`main` is the build sequence).
 *
 * @public
 */
export type TimelineRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'timeline';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The screen it belongs to. */
  readonly screenId: RecordId;
  /** Name; `main` is the click-through build sequence. */
  readonly name: string;
  /** Order among the screen's timelines. */
  readonly index: IndexKey;
  /** Restart after the last step. */
  readonly loop?: boolean;
}>;

/**
 * One step of a timeline: a trigger and the animations it starts.
 *
 * @public
 */
export type StepRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'step';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The timeline it belongs to. */
  readonly timelineId: RecordId;
  /** Order in the timeline. */
  readonly index: IndexKey;
  /** When the step runs. */
  readonly trigger: Tagged;
  /** Animations started by the step (shapes in 07-animation-and-interaction §2). */
  readonly animations: readonly StepAnimation[];
  /** Label in the timeline panel. */
  readonly label?: string;
}>;

/**
 * A trigger → actions rule on an element, a screen or the document.
 *
 * @public
 */
export type InteractionRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'interaction';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The element, screen or document it is attached to. */
  readonly ownerId: RecordId;
  /** What starts it. */
  readonly trigger: Tagged;
  /** Safe expression that must hold for the actions to run. */
  readonly condition?: string;
  /** Actions, run in order. */
  readonly actions: readonly Tagged[];
}>;

/**
 * A document variable (FR-DOC-008).
 *
 * @public
 */
export type VariableRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'variable';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** Name used in expressions. */
  readonly name: string;
  /** Value type. */
  readonly valueType: 'string' | 'number' | 'boolean' | 'color' | 'json';
  /** Initial value. */
  readonly default?: unknown;
}>;

/**
 * A review comment on a record.
 *
 * @public
 */
export type CommentRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'comment';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The commented record. */
  readonly targetId: RecordId;
  /** Author name. */
  readonly author: string;
  /** Comment text. */
  readonly body: string;
  /** Whether it is resolved. */
  readonly resolved: boolean;
  /** Creation time, ISO 8601. */
  readonly created?: string;
}>;

const tagged = checkedSchema<Tagged>()(z.looseObject({ kind: z.string().min(1) }));
const envelope = { id: recordIdSchema, meta: metaSchema.optional() };

/** Schema of the `timeline` record. */
export const timelineRecordSchema: z.ZodType<TimelineRecord> = checkedSchema<TimelineRecord>()(
  z.looseObject({
    ...envelope,
    type: z.literal('timeline'),
    screenId: recordIdSchema,
    name: z.string().min(1),
    index: indexKeySchema,
    loop: z.boolean().optional(),
  }),
);

/** Schema of the `step` record. */
export const stepRecordSchema: z.ZodType<StepRecord> = checkedSchema<StepRecord>()(
  z.looseObject({
    ...envelope,
    type: z.literal('step'),
    timelineId: recordIdSchema,
    index: indexKeySchema,
    trigger: tagged,
    animations: z.array(z.looseObject({ id: z.string().min(1) })),
    label: z.string().optional(),
  }),
);

/** Schema of the `interaction` record. */
export const interactionRecordSchema: z.ZodType<InteractionRecord> = checkedSchema<InteractionRecord>()(
  z.looseObject({
    ...envelope,
    type: z.literal('interaction'),
    ownerId: recordIdSchema,
    trigger: tagged,
    condition: z.string().optional(),
    actions: z.array(tagged),
  }),
);

/** Schema of the `variable` record. */
export const variableRecordSchema: z.ZodType<VariableRecord> = checkedSchema<VariableRecord>()(
  z.looseObject({
    ...envelope,
    type: z.literal('variable'),
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'expected an identifier'),
    valueType: z.enum(['string', 'number', 'boolean', 'color', 'json']),
    default: z.unknown().optional(),
  }),
);

/** Schema of the `comment` record. */
export const commentRecordSchema: z.ZodType<CommentRecord> = checkedSchema<CommentRecord>()(
  z.looseObject({
    ...envelope,
    type: z.literal('comment'),
    targetId: recordIdSchema,
    author: z.string(),
    body: z.string(),
    resolved: z.boolean().default(false),
    created: z.iso.datetime({ offset: true }).optional(),
  }),
);

/**
 * A behaviour or review record.
 *
 * @public
 */
export type BehaviourRecord = TimelineRecord | StepRecord | InteractionRecord | VariableRecord | CommentRecord;
