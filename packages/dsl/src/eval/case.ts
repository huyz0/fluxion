// The eval case and recording shapes (ADR-0039, FR-AI-009): data only, validated with Zod so a typo in a case file is an error, not a skipped check.
import { z } from 'zod';

/**
 * What a case expects of its result.
 *
 * @public
 */
export type EvalExpect = {
  /** The least and the most screens the result may have. */
  readonly screens?: readonly [number, number] | undefined;
  /** Element kinds that must appear. */
  readonly kinds?: readonly string[] | undefined;
  /** Strings that must appear in a title, label or text. */
  readonly mustContain?: readonly string[] | undefined;
  /** The least lint score. */
  readonly minLint?: number | undefined;
};

/**
 * The starting file of an `edit` or `repair` case.
 *
 * @public
 */
export type EvalInputs = {
  /** The FluxScript text. */
  readonly document: string;
};

/**
 * One eval case: a prompt and what to expect.
 *
 * @public
 */
export type EvalCase = {
  /** Unique slug; also the file name. */
  readonly id: string;
  /** `generate` a deck, `edit` a document with a patch, or `repair` a broken file. */
  readonly mode: 'generate' | 'edit' | 'repair';
  /** What the user asks. */
  readonly prompt: string;
  /** The starting FluxScript for `edit` and `repair`. */
  readonly inputs?: EvalInputs | undefined;
  /** What the result must satisfy. */
  readonly expect: EvalExpect;
};

/**
 * The schema of an {@link EvalCase}; an unknown key is rejected.
 *
 * @public
 */
export const evalCaseSchema: z.ZodType<EvalCase> = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  mode: z.enum(['generate', 'edit', 'repair']),
  prompt: z.string().min(1),
  inputs: z.strictObject({ document: z.string().min(1) }).optional(),
  expect: z.strictObject({
    screens: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
    kinds: z.array(z.string().min(1)).optional(),
    mustContain: z.array(z.string().min(1)).optional(),
    minLint: z.number().min(0).max(100).optional(),
  }),
}) as unknown as z.ZodType<EvalCase>;

/**
 * What a model answered to one request of a run.
 *
 * @public
 */
export type RecordedRequest = {
  /** The reply, in the chunks it streamed in. */
  readonly chunks: readonly string[];
  /** Tokens read, as reported. */
  readonly tokensIn: number;
  /** Tokens written, as reported. */
  readonly tokensOut: number;
};

/**
 * The replies of a model to a case, in request order.
 *
 * @public
 */
export type Recording = {
  /** Format version. */
  readonly version: 1;
  /** Who wrote the replies: `live` from a provider, `scripted` by the harness author (no model involved). */
  readonly source: 'live' | 'scripted';
  /** The model id, part of the recording key. */
  readonly model: string;
  /** One entry per request the run makes. */
  readonly requests: readonly RecordedRequest[];
};

/**
 * The schema of a {@link Recording}.
 *
 * @public
 */
export const recordingSchema: z.ZodType<Recording> = z.strictObject({
  version: z.literal(1),
  source: z.enum(['live', 'scripted']),
  model: z.string().min(1),
  requests: z.array(z.strictObject({ chunks: z.array(z.string()), tokensIn: z.number().int().min(0), tokensOut: z.number().int().min(0) })),
}) as unknown as z.ZodType<Recording>;
