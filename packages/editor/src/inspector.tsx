// The inspector's fields (FR-EDT-008, M7.16): the widgets for what `inspect` (inspector-model.ts) says the
// selection has in common. A number scrubs (drag its label; shift is coarse, alt fine) or is typed, a slider
// slides, a toggle toggles, an enum is a row of buttons or a menu, a paint is a colour input with a token
// list; a field the elements disagree on shows "Mixed" and setting it sets all of them. Every apply is one
// `element.updateMany`: a typed value or a click is one undo step, a scrub or a slide one for the whole drag.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { FieldDef, RecordId } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useRef } from 'react';
import { applyField, type InspectorField, type Inspectors, inspect } from './inspector-model.js';
import { colorTokenRefs, isHex6, parseNumber, scrubbed } from './inspector-values.js';
import { beginGesture, type Execute, type Gesture } from './pointer.js';
import type { Session } from './session.js';

/** Props of {@link InspectorFields}. */
export type InspectorFieldsProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection it shows. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
  /** The plugins' field overrides. */
  readonly inspectors?: Inspectors | undefined;
};

/** What a widget does to the selection: a one-step change, or a drag's changes as one step. */
type Apply = {
  /** Set the field now, as one undo step. */
  set(value: unknown): void;
  /** Set the field as part of a drag; `end` closes the drag's one step. */
  drag(value: unknown): void;
  /** End the drag. */
  end(): void;
};

const COLOR_TOKENS = colorTokenRefs(LIGHT_THEME);

/** The inspector's sections for the selection, or nothing when no element is selected. */
export function InspectorFields(props: InspectorFieldsProps): ReactNode {
  const { store, session, execute, inspectors } = props;
  const ids = useValue(session.selection.get);
  const model = useValue(useMemo(() => store.query((view) => inspect(view, ids, inspectors)), [store, ids, inspectors]));
  const gesture = useRef<Gesture | undefined>(undefined);
  const selected = useRef<readonly RecordId[]>([]);
  selected.current = model?.ids ?? [];
  // the selection changed under a drag: its step ends where it was
  const selectedKey = model?.ids.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the drag ends when the selection's ids change, not on every edit
  useEffect(() => () => void gesture.current?.end(), [selectedKey]);
  if (model === undefined) return null;
  const applier = (def: FieldDef): Apply => {
    const command = (value: unknown) => applyField(store, selected.current, def.path, value);
    return {
      set: (value) => {
        const c = command(value);
        if (c !== undefined) execute(c.id, c.args);
        store.history.seal();
      },
      drag: (value) => {
        const c = command(value);
        if (c === undefined) return;
        gesture.current ??= beginGesture(execute, () => store.history.seal());
        gesture.current.update(c.id, c.args);
        gesture.current.commit();
      },
      end: () => {
        gesture.current?.end();
        gesture.current = undefined;
      },
    };
  };
  return (
    <div className="fx-chrome-fields">
      {model.groups.map((group) => (
        <fieldset key={group.name} className="fx-chrome-group">
          <legend className="fx-chrome-heading">{group.name}</legend>
          {group.fields.map((f) => (
            <FieldRow key={f.def.path.join('/')} field={f} apply={applier(f.def)} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** One field: its label and the widget its `ui` names. */
function FieldRow(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  const { def } = field;
  switch (def.ui) {
    case 'number':
      return <NumberField field={field} apply={apply} />;
    case 'slider':
      return <SliderField field={field} apply={apply} />;
    case 'toggle':
      return <ToggleField field={field} apply={apply} />;
    case 'select':
      return <SelectField field={field} apply={apply} />;
    case 'paint':
      return <PaintField field={field} apply={apply} />;
    case 'text':
      return <TextField field={field} apply={apply} />;
    default:
      return null;
  }
}

/** How a stored value reads in a text box (a token reference or a number alike). */
const shown = (field: InspectorField): string => (field.mixed || field.value === undefined ? '' : String(field.value));

/** Enter commits what is typed, Escape gives it back. */
function commitKeys(e: KeyboardEvent<HTMLInputElement>, original: string): void {
  if (e.key === 'Enter') e.currentTarget.blur();
  else if (e.key === 'Escape') {
    e.currentTarget.value = original;
    e.currentTarget.blur();
  }
}

/** A number: typed (Enter or leaving commits) or scrubbed by dragging its label. */
function NumberField(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  const { def } = field;
  const start = useRef<{ readonly x: number; readonly value: number } | undefined>(undefined);
  const canScrub = !field.mixed && typeof field.value === 'number';
  const down = (e: PointerEvent<HTMLElement>) => {
    if (!canScrub) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, value: field.value as number };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (s !== undefined) apply.drag(scrubbed(def, s.value, e.clientX - s.x, { coarse: e.shiftKey, fine: e.altKey }));
  };
  const up = () => {
    if (start.current !== undefined) apply.end();
    start.current = undefined;
  };
  return (
    <label className="fx-chrome-field">
      <span
        className="fx-chrome-field-label"
        data-scrub={canScrub || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {def.label}
      </span>
      <input
        key={`${field.mixed}:${shown(field)}`}
        className="fx-chrome-input"
        type="text"
        inputMode="decimal"
        aria-label={def.label}
        defaultValue={shown(field)}
        placeholder={field.mixed ? 'Mixed' : ''}
        onKeyDown={(e) => commitKeys(e, shown(field))}
        onBlur={(e) => {
          const n = parseNumber(def, e.currentTarget.value);
          if (n === 'invalid') e.currentTarget.value = shown(field);
          else if (e.currentTarget.value !== shown(field)) apply.set(n);
        }}
      />
    </label>
  );
}

/** A slider: one undo step for the whole slide. */
function SliderField(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  const { def } = field;
  const value = typeof field.value === 'number' ? field.value : (def.max ?? 1);
  return (
    <label className="fx-chrome-field">
      <span className="fx-chrome-field-label">{def.label}</span>
      <input
        className="fx-chrome-slider"
        type="range"
        aria-label={def.label}
        aria-valuetext={field.mixed ? 'Mixed' : undefined}
        min={def.min ?? 0}
        max={def.max ?? 1}
        step={0.01}
        value={field.mixed ? (def.max ?? 1) : value}
        data-mixed={field.mixed || undefined}
        onChange={(e) => apply.drag(Number(e.currentTarget.value))}
        onPointerUp={apply.end}
        onKeyUp={apply.end}
        onBlur={apply.end}
      />
    </label>
  );
}

/** A checkbox, indeterminate while the elements differ. */
function ToggleField(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = field.mixed;
  }, [field.mixed]);
  return (
    <label className="fx-chrome-field">
      <span className="fx-chrome-field-label">{field.def.label}</span>
      <input
        ref={box}
        type="checkbox"
        aria-label={field.def.label}
        checked={field.value === true}
        onChange={(e) => apply.set(e.currentTarget.checked ? true : undefined)}
      />
    </label>
  );
}

/** A few options are a row of buttons, many a menu. */
function SelectField(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  const { def } = field;
  const options = def.options ?? [];
  if (options.length > 4)
    return (
      <label className="fx-chrome-field">
        <span className="fx-chrome-field-label">{def.label}</span>
        <select
          className="fx-chrome-input"
          aria-label={def.label}
          value={field.mixed ? '' : String(field.value ?? '')}
          onChange={(e) => apply.set(e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
        >
          {field.mixed || field.value === undefined ? <option value="">{field.mixed ? 'Mixed' : '—'}</option> : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <fieldset className="fx-chrome-field" aria-label={def.label}>
      <span className="fx-chrome-field-label">{def.label}</span>
      <span className="fx-chrome-choices">
        {options.map((o) => (
          <button key={o} type="button" className="fx-chrome-button" aria-pressed={!field.mixed && field.value === o} onClick={() => apply.set(o)}>
            {o}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

/** A colour: the system colour input for plain colours, a text box taking any colour or a token reference (with the theme's tokens listed), and a clear button. */
function PaintField(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  const { def } = field;
  const list = useId();
  return (
    <fieldset className="fx-chrome-field" aria-label={def.label}>
      <span className="fx-chrome-field-label">{def.label}</span>
      <input
        type="color"
        className="fx-chrome-swatch"
        aria-label={`${def.label} colour`}
        value={isHex6(field.value) && !field.mixed ? field.value : '#000000'}
        data-mixed={field.mixed || undefined}
        onChange={(e) => apply.drag(e.currentTarget.value)}
        onBlur={apply.end}
        onPointerUp={apply.end}
      />
      <input
        key={`${field.mixed}:${shown(field)}`}
        className="fx-chrome-input"
        type="text"
        list={list}
        aria-label={`${def.label} value`}
        defaultValue={typeof field.value === 'string' ? field.value : ''}
        placeholder={field.mixed ? 'Mixed' : 'none'}
        onKeyDown={(e) => commitKeys(e, typeof field.value === 'string' ? field.value : '')}
        onBlur={(e) => {
          const text = e.currentTarget.value.trim();
          if (text !== (typeof field.value === 'string' ? field.value : '')) apply.set(text === '' ? undefined : text);
        }}
      />
      <datalist id={list}>
        {COLOR_TOKENS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <button
        type="button"
        className="fx-chrome-button"
        aria-label={`Clear ${def.label}`}
        disabled={!field.mixed && field.value === undefined}
        onClick={() => apply.set(undefined)}
      >
        ×
      </button>
    </fieldset>
  );
}

/** A text box: Enter or leaving commits; empty clears. */
function TextField(props: { readonly field: InspectorField; readonly apply: Apply }): ReactNode {
  const { field, apply } = props;
  return (
    <label className="fx-chrome-field">
      <span className="fx-chrome-field-label">{field.def.label}</span>
      <input
        key={`${field.mixed}:${shown(field)}`}
        className="fx-chrome-input"
        type="text"
        aria-label={field.def.label}
        defaultValue={shown(field)}
        placeholder={field.mixed ? 'Mixed' : ''}
        onKeyDown={(e) => commitKeys(e, shown(field))}
        onBlur={(e) => {
          if (e.currentTarget.value !== shown(field)) apply.set(e.currentTarget.value === '' ? undefined : e.currentTarget.value);
        }}
      />
    </label>
  );
}
