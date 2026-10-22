// The JSON Schema of the catalog's `json` format (FR-AI-002, FR-AI-001): generated from a Zod schema, committed in specs/schema/ and drift-tested.
import { z } from 'zod';

const entrySchema = z.strictObject({
  id: z.string().min(1),
  describe: z.string(),
  source: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).optional(),
});

const list = z.array(entrySchema);

const catalogSchema = z.strictObject({
  shapes: list,
  connectors: list,
  markers: list,
  layouts: list,
  templates: list,
  themes: list,
  effects: list,
  transitions: list,
});

/**
 * The JSON Schema of the catalog's `json` format.
 *
 * @public
 */
export function catalogJsonSchema(): { readonly [key: string]: unknown } {
  return { title: 'Fluxion catalog', ...z.toJSONSchema(catalogSchema, { unrepresentable: 'any', io: 'input' }) };
}

/** Whether `value` is a catalog in the `json` format. */
export function isCatalogJson(value: unknown): boolean {
  return catalogSchema.safeParse(value).success;
}
