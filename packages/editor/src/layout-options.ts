// The layout options form's model (FR-LAY-001, M17.17): the fields of a layout's or template's options, read from the JSON Schema of its options
// (`layoutOptionsJsonSchema` / `templateOptionsJsonSchema`, which the host gives the editor; the editor has no schema library of its own), and a
// typed entry read back into a value. Pure: no DOM, no React.
import { APPLY_PATCH_COMMAND_ID } from '@fluxion/dsl';

/**
 * One option as a form field.
 *
 * @public
 */
export type OptionField = {
  /** The option's name in the layout spec's `options`. */
  readonly key: string;
  /** The widget: a number or whole-number entry, a toggle, a choice of words, or text. */
  readonly kind: 'number' | 'integer' | 'boolean' | 'choice' | 'text';
  /** The value the layout uses when the option is not set. */
  readonly default?: unknown;
  /** The smallest number allowed. */
  readonly minimum?: number;
  /** The largest number allowed. */
  readonly maximum?: number;
  /** The words a choice offers. */
  readonly choices?: readonly string[];
};

type Obj = { readonly [key: string]: unknown };

/** The layout type of a template spec (schema 1.7, ADR-0047): its `id` names the template, its `items` what it is built from. */
const TEMPLATE = 'template';

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The widget of one property schema, or undefined for one the form does not edit (an object, a list). */
function kindOf(p: Obj): OptionField['kind'] | undefined {
  if (Array.isArray(p['enum']) && p['enum'].every((x) => typeof x === 'string')) return 'choice';
  const type = p['type'];
  if (type === 'number' || type === 'integer' || type === 'boolean') return type;
  return type === 'string' ? 'text' : undefined;
}

/** One property as a field; the bounds and choices only when the schema gives them. */
function fieldOf(key: string, p: Obj): OptionField | undefined {
  const kind = kindOf(p);
  if (kind === undefined) return undefined;
  return {
    key,
    kind,
    ...('default' in p ? { default: p['default'] } : {}),
    ...(typeof p['minimum'] === 'number' ? { minimum: p['minimum'] } : {}),
    ...(typeof p['maximum'] === 'number' ? { maximum: p['maximum'] } : {}),
    ...(kind === 'choice' ? { choices: p['enum'] as string[] } : {}),
  };
}

/**
 * The fields of an options schema, in the schema's order: numbers, whole numbers, toggles, choices and text; anything else is left out.
 *
 * @public
 */
export function optionFields(schema: unknown): readonly OptionField[] {
  const properties = isObj(schema) ? schema['properties'] : undefined;
  if (!isObj(properties)) return [];
  return Object.entries(properties).flatMap(([key, p]) => {
    const field = isObj(p) ? fieldOf(key, p) : undefined;
    return field ? [field] : [];
  });
}

/**
 * What an entry reads as: the option's value, or why it is refused.
 *
 * @public
 */
export type OptionEntry =
  | {
      /** The entry is good. */
      readonly ok: true;
      /** The option's value. */
      readonly value: unknown;
    }
  | {
      /** The entry is refused. */
      readonly ok: false;
      /** Why, in words. */
      readonly message: string;
    };

/** A typed number checked against the field's bounds. */
function readNumber(field: OptionField, text: string): OptionEntry {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value)) return { ok: false, message: `${field.key} is a number` };
  if (field.kind === 'integer' && !Number.isInteger(value)) return { ok: false, message: `${field.key} is a whole number` };
  if (field.minimum !== undefined && value < field.minimum) return { ok: false, message: `${field.key} is at least ${field.minimum}` };
  if (field.maximum !== undefined && value > field.maximum) return { ok: false, message: `${field.key} is at most ${field.maximum}` };
  return { ok: true, value };
}

/**
 * Read an entry of `field`: typed text for a number or text, `true`/`false` for a toggle, one of the words for a choice.
 *
 * @public
 */
export function readOption(field: OptionField, entry: string | boolean): OptionEntry {
  if (field.kind === 'boolean') return typeof entry === 'boolean' ? { ok: true, value: entry } : { ok: false, message: `${field.key} is on or off` };
  const text = String(entry);
  if (field.kind === 'number' || field.kind === 'integer') return readNumber(field, text); // kind-switch-allow: the closed set of form widgets an options schema maps to
  if (field.kind === 'choice' && !field.choices?.includes(text)) return { ok: false, message: `${field.key} is one of ${field.choices?.join(', ')}` }; // kind-switch-allow: the closed set of form widgets an options schema maps to
  return { ok: true, value: text };
}

/**
 * The value a field shows: the option as set, else the layout's default.
 *
 * @public
 */
export function shownOption(field: OptionField, options: unknown): unknown {
  const set = isObj(options) ? options[field.key] : undefined;
  return set ?? field.default;
}

/**
 * A layout spec as written on a screen, group or frame.
 *
 * @public
 */
export type WrittenLayoutSpec = {
  /** The layout's registered id. */
  readonly type: string;
  /** Its `options`, and anything else it has, such as `live`. */
  readonly [key: string]: unknown;
};

/**
 * Whose layout the form edits: the one selected group or frame, or, with nothing selected, the shown screen; each only when it has a layout spec.
 *
 * @public
 */
export type LayoutTarget = {
  /** A container's layout is written with `element.update`, a screen's with `screen.setLayout`. */
  readonly kind: 'container' | 'screen';
  /** The group, frame or screen. */
  readonly id: string;
  /** Its layout spec as written (its `type`, `options` and anything else it has, such as `live`). */
  readonly spec: WrittenLayoutSpec;
};

/** The layout spec of a record, when it has one. */
function specOf(record: unknown): WrittenLayoutSpec | undefined {
  const layout = isObj(record) ? record['layout'] : undefined;
  if (!isObj(layout) || typeof layout['type'] !== 'string') return undefined;
  return layout as WrittenLayoutSpec;
}

/** The shown screen's layout, when it has one. */
function screenTarget(get: (id: string) => unknown, screenId: string | undefined): LayoutTarget | undefined {
  const spec = screenId === undefined ? undefined : specOf(get(screenId));
  return spec && screenId !== undefined ? { kind: 'screen', id: screenId, spec } : undefined;
}

/**
 * The layout the form edits for a selection on a screen, if any.
 *
 * @public
 */
export function layoutTarget(get: (id: string) => unknown, selection: readonly string[], screenId: string | undefined): LayoutTarget | undefined {
  if (selection.length === 0) return screenTarget(get, screenId);
  const [only] = selection;
  if (selection.length !== 1 || only === undefined) return undefined;
  const record = get(only);
  const kind = isObj(record) ? record['kind'] : undefined;
  const spec = kind === 'group' || kind === 'frame' ? specOf(record) : undefined; // kind-switch-allow: only a group or frame holds a layout spec (schema)
  // a template is built into a screen, not a group (the patch refuses it): a container's form would only refuse every edit
  return spec && spec.type !== TEMPLATE ? { kind: 'container', id: only, spec } : undefined;
}

/**
 * How the form writes: the command runner (`execute(id, args, options)`), whose result says whether the document took it.
 *
 * @public
 */
export type OptionWriter = (
  id: string,
  args: unknown,
  options?: { readonly amend?: true },
) => {
  /** Whether the document took the command. */
  readonly ok: boolean;
};

/** A template's options written and the template built again, through the patch command (ADR-0047): its shapes and connectors are replaced. */
function rebuildTemplate(execute: OptionWriter, target: LayoutTarget, options: Obj): boolean {
  const { id, items } = target.spec;
  const layout = { type: 'template', id, items, options };
  return execute(APPLY_PATCH_COMMAND_ID, { patch: { flux: 1, ops: [{ op: 'setLayout', scope: `#${target.id}`, layout }] } }).ok;
}

/**
 * Set one option of the target's layout and lay it out again with the new options: the spec is written (`element.update` or `screen.setLayout`),
 * then `layout.arrange` runs as an amend, so one undo takes back both. A template is built again instead, in one patch. False when the document
 * refused the spec; the arrange may refuse on its own (nothing to lay out) without undoing the spec.
 *
 * @public
 */
export function setLayoutOption(
  execute: OptionWriter,
  target: LayoutTarget,
  at: { readonly screenId: string; readonly key: string; readonly value: unknown },
): boolean {
  const options = { ...(isObj(target.spec['options']) ? target.spec['options'] : {}), [at.key]: at.value };
  if (target.spec.type === TEMPLATE) return rebuildTemplate(execute, target, options);
  const layout = { ...target.spec, options };
  const written =
    target.kind === 'container' ? execute('element.update', { id: target.id, fields: { layout } }) : execute('screen.setLayout', { id: target.id, layout });
  if (!written.ok) return false;
  const scope = target.kind === 'container' ? { containerId: target.id } : 'screen'; // kind-switch-allow: a layout target is a container or the screen, a closed pair
  execute('layout.arrange', { screenId: at.screenId, scope, algorithm: target.spec.type, options }, { amend: true });
  return true;
}
