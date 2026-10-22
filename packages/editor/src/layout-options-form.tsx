// The layout options form (FR-LAY-001, M17.17): for the selected group or frame, or the shown screen with nothing selected, the options of its
// layout as fields built from the layout's options schema. A typed number or text is set on blur or Enter (Escape gives the entry back), a toggle
// or a choice at once; each change writes the spec and lays the target out again, one undo step (layout-options.ts).
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo } from 'react';
import { commitKeys } from './inspector-keys.js';
import {
  type LayoutTarget,
  layoutTarget,
  type OptionField,
  optionFields,
  readOption,
  setLayoutOption,
  shownOption,
  type WrittenLayoutSpec,
} from './layout-options.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

/**
 * The JSON Schema of the options of a layout spec, as the host knows it: a layout's by its `type`, a template's (`type: 'template'`) by its `id`;
 * undefined for one it does not know.
 *
 * @public
 */
export type OptionsSchemaOf = (layout: WrittenLayoutSpec) => unknown;

/**
 * Props of {@link LayoutOptionsSection}.
 *
 * @public
 */
export type LayoutOptionsSectionProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection picks the target. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
  /** The screen shown. */
  readonly screenId: string | undefined;
  /** The options schema of a layout spec. */
  readonly schemaOf: OptionsSchemaOf;
};

/** One field's props: the field, the value it shows, and what to do with a new entry (false when it is refused). */
type RowProps = { readonly field: OptionField; readonly value: unknown; readonly set: (entry: string | boolean) => boolean };

/** A toggle, set at once. */
function ToggleRow({ field, value, set }: RowProps): ReactNode {
  return (
    <label className="fx-chrome-field">
      <span className="fx-chrome-field-label">{field.key}</span>
      <input type="checkbox" aria-label={field.key} checked={value === true} onChange={(e) => set(e.currentTarget.checked)} />
    </label>
  );
}

/** A choice of words, set at once; a blank first entry while the option has no value. */
function ChoiceRow({ field, value, set }: RowProps): ReactNode {
  return (
    <label className="fx-chrome-field">
      <span className="fx-chrome-field-label">{field.key}</span>
      <select className="fx-chrome-input" aria-label={field.key} value={String(value ?? '')} onChange={(e) => set(e.currentTarget.value)}>
        {value === undefined ? <option value="">—</option> : null}
        {(field.choices ?? []).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A typed number or text, set on blur or Enter; a refused entry is given back. */
function EntryRow({ field, value, set }: RowProps): ReactNode {
  const shown = value === undefined ? '' : String(value);
  return (
    <label className="fx-chrome-field">
      <span className="fx-chrome-field-label">{field.key}</span>
      <input
        key={shown}
        className="fx-chrome-input"
        type="text"
        inputMode={field.kind === 'text' ? 'text' : 'decimal'}
        aria-label={field.key}
        defaultValue={shown}
        onKeyDown={(e) => commitKeys(e, shown)}
        onBlur={(e) => {
          if (e.currentTarget.value !== shown && !set(e.currentTarget.value)) e.currentTarget.value = shown;
        }}
      />
    </label>
  );
}

/** The row of each widget. */
const ROW_OF: { readonly [K in OptionField['kind']]: (props: RowProps) => ReactNode } = {
  boolean: ToggleRow,
  choice: ChoiceRow,
  number: EntryRow,
  integer: EntryRow,
  text: EntryRow,
};

/**
 * The options form of the layout of `target`, from the fields of its options schema.
 *
 * @public
 */
export function LayoutOptionsForm(props: {
  readonly target: LayoutTarget;
  readonly fields: readonly OptionField[];
  readonly set: (field: OptionField, value: unknown) => boolean;
}): ReactNode {
  const { target, fields, set } = props;
  const type = target.spec.type;
  return (
    <fieldset className="fx-chrome-group" aria-label={t`Layout options`}>
      <legend className="fx-chrome-heading">{t`Layout: ${type}`}</legend>
      {fields.map((field) => {
        const Row = ROW_OF[field.kind];
        const write = (entry: string | boolean) => {
          const read = readOption(field, entry);
          return read.ok && set(field, read.value);
        };
        return <Row key={field.key} field={field} value={shownOption(field, target.spec['options'])} set={write} />;
      })}
    </fieldset>
  );
}

/**
 * The layout options of the selected group or frame, or of the shown screen when nothing is selected; nothing when that has no layout spec or the
 * host knows no schema for its layout.
 *
 * @public
 */
export function LayoutOptionsSection(props: LayoutOptionsSectionProps): ReactNode {
  const { store, session, execute, screenId, schemaOf } = props;
  const selection = useValue(session.selection.get);
  const target = useValue(useMemo(() => store.query((view) => layoutTarget((id) => view.get(id as never), selection, screenId)), [store, selection, screenId]));
  // the schema depends on the layout's type and a template's id, not on its options: a changed option keeps the fields
  const type = target?.spec.type;
  const templateId = target?.spec['id'];
  const fields = useMemo(
    () => (type === undefined ? [] : optionFields(schemaOf({ type, ...(templateId === undefined ? {} : { id: templateId }) }))),
    [type, templateId, schemaOf],
  );
  if (target === undefined || screenId === undefined || fields.length === 0) return null;
  return (
    <LayoutOptionsForm
      target={target}
      fields={fields}
      set={(field, value) => {
        const ok = setLayoutOption(execute, target, { screenId, key: field.key, value });
        store.history.seal();
        return ok;
      }}
    />
  );
}
