// The `--json` contract (docs/standards/contracts.md §1 and §6, ADR-0147): one Zod schema per
// command reply, the source of the generated snapshots packages/cli/schemas/<command>.output.json
// and, from M15, of the MCP tool output shapes. Each reply carries `apiVersion`, `ok` and either a
// `result` (ok) or `errors[]` (not ok); `run` parses every reply with its schema before printing it.
import { DSL_CODES } from '@fluxion/dsl';
import { DIAGNOSTIC_CODES } from '@fluxion/schema';
import { z } from 'zod';

/** The version of the reply shape; a major change of it needs an ADR (contracts.md rule 3). */
export const API_VERSION: 1 = 1;

const diagnosticSchema = z
  .object({
    code: z.enum([...Object.keys(DIAGNOSTIC_CODES), ...Object.keys(DSL_CODES)] as [string, ...string[]]),
    severity: z.enum(['error', 'warning', 'info']),
    path: z.string().regex(/^(\/.*)?$/, 'a JSON pointer'),
    message: z.string(),
    hint: z.string().optional(),
    // the elements a lint finding is about
    elements: z.array(z.string()).optional(),
  })
  .strict();

const helpResult = z.object({ help: z.string() }).strict();
const versionResult = z.object({ version: z.string() }).strict();

/** One command's reply: success with its result, or failure with the diagnostics that caused it. */
function reply<C extends z.ZodType, R extends z.ZodType>(command: C, result: R) {
  return z.discriminatedUnion('ok', [
    z
      .object({
        apiVersion: z.literal(API_VERSION),
        command,
        ok: z.literal(true),
        exitCode: z.literal(0),
        result,
        // warnings and infos of a successful run (ADR-0036)
        diagnostics: z.array(diagnosticSchema).optional(),
      })
      .strict(),
    z
      .object({
        apiVersion: z.literal(API_VERSION),
        command,
        ok: z.literal(false),
        exitCode: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        // a failure always says why (M4.17 review F1)
        errors: z.array(diagnosticSchema).min(1),
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
  render: reply(
    z.literal('render'),
    z.union([z.object({ out: z.string(), screens: z.number().int().min(0), files: z.array(z.string()).optional() }).strict(), helpResult, versionResult]),
  ),
  convert: reply(
    z.literal('convert'),
    z.union([
      z
        .object({ from: z.string(), to: z.string(), direction: z.enum(['to-html', 'to-flux', 'to-json', 'from-json']), bytes: z.number().int().min(0) })
        .strict(),
      helpResult,
      versionResult,
    ]),
  ),
  compile: reply(
    z.literal('compile'),
    z.union([z.object({ out: z.string(), screens: z.number().int().min(0), records: z.number().int().min(0) }).strict(), helpResult, versionResult]),
  ),
  lint: reply(
    z.literal('lint'),
    z.union([
      z
        .object({
          score: z.number().min(0).max(100),
          findings: z.array(diagnosticSchema),
        })
        .strict(),
      helpResult,
      versionResult,
    ]),
  ),
  layout: reply(
    z.literal('layout'),
    z.union([z.object({ out: z.string(), algorithm: z.string(), screens: z.number().int().min(0) }).strict(), helpResult, versionResult]),
  ),
  migrate: reply(z.literal('migrate'), z.union([z.object({ out: z.string(), applied: z.array(z.string()) }).strict(), helpResult, versionResult])),
  patch: reply(
    z.literal('patch'),
    z.union([
      z.object({ out: z.string(), ops: z.number().int().min(0), changed: z.number().int().min(0), revision: z.string() }).strict(),
      helpResult,
      versionResult,
    ]),
  ),
  decompile: reply(z.literal('decompile'), z.union([z.object({ out: z.string(), kept: z.number().int().min(0) }).strict(), helpResult, versionResult])),
  catalog: reply(
    z.literal('catalog'),
    z.union([
      z.object({ format: z.enum(['llm', 'json', 'md']), bytes: z.number().int().min(0), out: z.string().optional(), text: z.string().optional() }).strict(),
      helpResult,
      versionResult,
    ]),
  ),
};

/**
 * The JSON Schema of every command's reply in one document (specs/schema/cli-result.json): a reply of any command validates against it.
 *
 * @public
 */
export function resultJsonSchema(): object {
  const replies = Object.keys(OUTPUT_SCHEMAS).map((c) => z.toJSONSchema(OUTPUT_SCHEMAS[c] as z.ZodType));
  return { $id: 'https://fluxion.dev/schemas/cli-result.json', title: 'Fluxion CLI result', anyOf: replies };
}

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
