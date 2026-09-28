// The `--json` contract (docs/standards/contracts.md §1 and §6, ADR-0147): one Zod schema per
// command reply, the source of the generated snapshots packages/cli/schemas/<command>.output.json
// and, from M15, of the MCP tool output shapes. Each reply carries `apiVersion`, `ok` and either a
// `result` (ok) or `errors[]` (not ok); `run` parses every reply with its schema before printing it.
import { DIAGNOSTIC_CODES } from '@fluxion/schema';
import { z } from 'zod';

/** The version of the reply shape; a major change of it needs an ADR (contracts.md rule 3). */
export const API_VERSION: 1 = 1;

const diagnosticSchema = z
  .object({
    code: z.enum(Object.keys(DIAGNOSTIC_CODES) as [keyof typeof DIAGNOSTIC_CODES, ...(keyof typeof DIAGNOSTIC_CODES)[]]),
    severity: z.enum(['error', 'warning', 'info']),
    path: z.string().regex(/^(\/.*)?$/, 'a JSON pointer'),
    message: z.string(),
    hint: z.string().optional(),
  })
  .strict();

const helpResult = z.object({ help: z.string() }).strict();
const versionResult = z.object({ version: z.string() }).strict();

/** One command's reply: success with its result, or failure with the diagnostics that caused it. */
function reply<C extends z.ZodType, R extends z.ZodType>(command: C, result: R) {
  return z.discriminatedUnion('ok', [
    z.object({ apiVersion: z.literal(API_VERSION), command, ok: z.literal(true), exitCode: z.literal(0), result }).strict(),
    z
      .object({
        apiVersion: z.literal(API_VERSION),
        command,
        ok: z.literal(false),
        exitCode: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        errors: z.array(diagnosticSchema),
      })
      .strict(),
  ]);
}

/**
 * The reply schema of each command; `fluxion` is the reply without a command (help, version, a
 * usage error before any command was recognised).
 *
 * @public
 */
export const OUTPUT_SCHEMAS: { readonly [command: string]: z.ZodType } = {
  fluxion: reply(z.null(), z.union([helpResult, versionResult])),
  validate: reply(z.literal('validate'), z.union([z.object({ diagnostics: z.array(diagnosticSchema) }).strict(), helpResult, versionResult])),
  render: reply(z.literal('render'), z.union([z.object({ out: z.string(), screens: z.number().int().min(0) }).strict(), helpResult, versionResult])),
};

/**
 * The JSON Schema snapshot of `command`'s reply (packages/cli/schemas/<command>.output.json).
 *
 * @public
 */
export function outputJsonSchema(command: string): object {
  const schema = OUTPUT_SCHEMAS[command];
  if (schema === undefined) throw new Error(`no output schema for "${command}"`);
  return { $id: `https://fluxion.dev/schemas/cli/${command}.output.json`, ...z.toJSONSchema(schema) };
}
