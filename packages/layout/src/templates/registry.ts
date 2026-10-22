// Registering and building templates (FR-LAY-014, ADR-0047): a template is a `templates` registry entry under its id, beside `layouts`, with
// the same register and list pattern; `buildTemplate` checks the items and options, adapts them to the frame and builds.
import type { Registry } from '@fluxion/core';
import { z } from 'zod';
import type { RegisterLayoutResult } from '../registry.js';
import { cycleBasicTemplate } from './cycle.js';
import { hierarchyOrgTemplate } from './hierarchy.js';
import { processBasicTemplate, processChevronTemplate } from './process.js';
import { pyramidTemplate } from './pyramid.js';
import type { TemplateContext, TemplateDef, TemplateResult } from './types.js';

const isSchema = (s: unknown): boolean => typeof s === 'object' && s !== null && typeof (s as { safeParse?: unknown }).safeParse === 'function';

/** Why `value` is not a template, or undefined when it is one. */
function shapeProblem(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return 'a template must be an object';
  const t = value as Partial<TemplateDef<unknown>>;
  if (typeof t.id !== 'string' || t.id === '') return 'a template needs an id';
  if (typeof t.version !== 'string') return `template "${t.id}" needs a version`;
  if (typeof t.build !== 'function') return `template "${t.id}" needs a build function`;
  if (!isSchema(t.items)) return `template "${t.id}" needs an items schema`;
  if (!isSchema(t.schema)) return `template "${t.id}" needs an options schema`;
  if (typeof t.slots !== 'object' || t.slots === null) return `template "${t.id}" needs slots`;
  if (t.adapt !== undefined && typeof t.adapt !== 'function') return `template "${t.id}": adapt must be a function`;
  return undefined;
}

/**
 * Register `template` in a host's `templates` registry for `source`. A value that is not a template (no id, version, `build`, items or
 * options schema, or slots) is refused with its reason and nothing is registered.
 *
 * @public
 */
export function registerTemplate<O>(templates: Registry<string, unknown>, template: TemplateDef<O>, source: string): RegisterLayoutResult {
  const problem = shapeProblem(template);
  if (problem) return { ok: false, message: problem };
  const r = templates.register(template.id, template, source);
  return r.ok ? { ok: true } : { ok: false, message: r.error.message };
}

/**
 * The registered templates, sorted by id: what the picker and the catalog list. Entries that are not templates are left out.
 *
 * @public
 */
export function listTemplates(templates: Registry<string, unknown>): readonly TemplateDef<unknown>[] {
  return templates
    .list()
    .map(([, value]) => value)
    .filter((value): value is TemplateDef<unknown> => shapeProblem(value) === undefined);
}

/**
 * The options of `template` as JSON Schema, for the options form, AI catalog and MCP tool schemas.
 *
 * @public
 */
export function templateOptionsJsonSchema(template: TemplateDef<unknown>): unknown {
  return z.toJSONSchema(template.schema, { io: 'input' });
}

/**
 * The outcome of {@link buildTemplate}: what was built, or why the items or options were refused.
 *
 * @public
 */
export type BuildTemplateResult =
  | {
      /** Built. */
      readonly ok: true;
      /** The shapes and connectors. */
      readonly value: TemplateResult;
    }
  | {
      /** Refused. */
      readonly ok: false;
      /** Which input was wrong and why. */
      readonly message: string;
    };

const problemOf = (what: string, error: z.ZodError): string => {
  const issue = error.issues[0];
  return `${what}: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}`;
};

/**
 * Build `template` from raw `items` and `options` in `ctx`: both are checked against the template's schemas, the options adapted to the
 * frame when the template adapts, then built. Never throws on bad input; it says which input was wrong.
 *
 * @public
 */
export function buildTemplate<O>(template: TemplateDef<O>, items: unknown, options: unknown, ctx: TemplateContext): BuildTemplateResult {
  const i = template.items.safeParse(items);
  if (!i.success) return { ok: false, message: problemOf(`${template.id} items`, i.error) };
  const o = template.schema.safeParse(options);
  if (!o.success) return { ok: false, message: problemOf(`${template.id} options`, o.error) };
  const adapted = template.adapt ? template.adapt(ctx.frame, o.data) : o.data;
  return { ok: true, value: template.build(i.data, adapted, ctx) };
}

/**
 * The built-in templates, in registration order: what {@link registerBuiltInTemplates} registers.
 *
 * @public
 */
export const builtInTemplates: readonly TemplateDef<never>[] = [
  processBasicTemplate,
  processChevronTemplate,
  cycleBasicTemplate,
  hierarchyOrgTemplate,
  pyramidTemplate,
] as readonly unknown[] as readonly TemplateDef<never>[];

/**
 * Register every built-in template in a host's `templates` registry for source `core`; the first refusal is what comes back.
 *
 * @public
 */
export function registerBuiltInTemplates(templates: Registry<string, unknown>): RegisterLayoutResult {
  const results = builtInTemplates.map((template) => registerTemplate(templates, template, 'core'));
  return results.find((r) => !r.ok) ?? { ok: true };
}
