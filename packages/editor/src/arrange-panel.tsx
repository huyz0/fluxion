// The arrange panel (FR-ARR-002, FR-ARR-003, FR-ARR-007, M19.13, M8 cp1 F2): in the inspector, for two or more selected elements, the
// align buttons with what they align to (the selection's bounds or one of them, the key object, which stays), distribute by equal gaps
// or by centres, tidy to a gap of the user's choosing, and match size to the key. Each button runs one core command: one undo step.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo, useState } from 'react';
import { ALIGN_MODES, DISTRIBUTE_AXES } from './arrange-edit.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';
import { commandTitle } from './titles.js';

/**
 * Props of {@link ArrangeSection}.
 *
 * @public
 */
export type ArrangeSectionProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection it arranges. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
};

type Named = { readonly name?: string; readonly semantic?: { readonly label?: string } };

/** What the key picker calls a selected element: its label, else its name, else nothing (the picker numbers it in selection order). */
const nameOf = (r: Named | undefined): string => r?.semantic?.label?.trim() || r?.name?.trim() || '';

/** A key choice's words: its place in the selection, and its name when it has one. */
const keyText = (n: number, name: string): string => (name === '' ? t`Key ${n}` : t`Key ${n}: ${name}`);

/** The gap the tidy box starts at (px); a box holding no number disables tidy. */
const DEFAULT_GAP = 20;

/**
 * The arrange controls of the selection: shown for two or more selected elements.
 *
 * @public
 */
export function ArrangeSection(props: ArrangeSectionProps): ReactNode {
  const { store, session, execute } = props;
  const selection = useValue(session.selection.get);
  // the names follow a rename while the panel is open
  const names = useValue(useMemo(() => store.query((view) => selection.map((id) => nameOf(view.get(id) as Named | undefined))), [store, selection]));
  // '' aligns to the selection's bounds; an id aligns to that key object (one of the selection)
  const [keyPick, setKey] = useState('');
  const [by, setBy] = useState<'gaps' | 'centers'>('gaps');
  const [gap, setGap] = useState(String(DEFAULT_GAP));
  if (selection.length < 2) return null;
  const key = selection.includes(keyPick as RecordId) ? (keyPick as RecordId) : undefined;
  const run = (id: string, args: unknown): void => {
    if (execute(id, args).ok) store.history.seal();
  };
  const tidyGap = Number.parseFloat(gap);
  return (
    <fieldset className="fx-chrome-group" aria-label={t`Arrange`}>
      <legend className="fx-chrome-heading">{t`Arrange`}</legend>
      <label className="fx-chrome-field">
        <span className="fx-chrome-field-label">{t`Align to`}</span>
        <select className="fx-chrome-input" aria-label={t`Align to`} value={key ?? ''} onChange={(e) => setKey(e.currentTarget.value)}>
          <option value="">{t`Selection`}</option>
          {selection.map((id, n) => (
            <option key={id} value={id}>
              {keyText(n + 1, names[n] ?? '')}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="fx-chrome-actions" aria-label={t`Align`}>
        {ALIGN_MODES.map(([mode, title]) => (
          <button
            key={mode}
            type="button"
            className="fx-chrome-button"
            onClick={() => run('element.align', { ids: selection, mode, to: key === undefined ? 'selection' : { key } })}
          >
            {commandTitle({ id: `selection.align.${mode}`, title })}
          </button>
        ))}
      </fieldset>
      <label className="fx-chrome-field">
        <span className="fx-chrome-field-label">{t`Distribute by`}</span>
        <select
          className="fx-chrome-input"
          aria-label={t`Distribute by`}
          value={by}
          onChange={(e) => setBy(e.currentTarget.value === 'centers' ? 'centers' : 'gaps')}
        >
          <option value="gaps">{t`Equal gaps`}</option>
          <option value="centers">{t`Centres`}</option>
        </select>
      </label>
      <fieldset className="fx-chrome-actions" aria-label={t`Distribute`}>
        {DISTRIBUTE_AXES.map(([axis, title]) => (
          <button
            key={axis}
            type="button"
            className="fx-chrome-button"
            disabled={selection.length < 3}
            onClick={() => run('element.distribute', { ids: selection, axis, by })}
          >
            {commandTitle({ id: `selection.distribute.${axis}`, title })}
          </button>
        ))}
      </fieldset>
      <label className="fx-chrome-field">
        <span className="fx-chrome-field-label">{t`Tidy gap`}</span>
        <input className="fx-chrome-input" type="number" min={0} aria-label={t`Tidy gap`} value={gap} onChange={(e) => setGap(e.currentTarget.value)} />
      </label>
      <fieldset className="fx-chrome-actions" aria-label={t`Tidy`}>
        <button
          type="button"
          className="fx-chrome-button"
          disabled={!(tidyGap >= 0)}
          onClick={() => run('element.distribute', { ids: selection, axis: 'horizontal', by: 'gaps', gap: tidyGap })}
        >
          {t`Tidy across`}
        </button>
        <button
          type="button"
          className="fx-chrome-button"
          disabled={!(tidyGap >= 0)}
          onClick={() => run('element.distribute', { ids: selection, axis: 'vertical', by: 'gaps', gap: tidyGap })}
        >
          {t`Tidy down`}
        </button>
      </fieldset>
      {key === undefined ? null : (
        <fieldset className="fx-chrome-actions" aria-label={t`Match size`}>
          <button type="button" className="fx-chrome-button" onClick={() => run('element.matchSize', { ids: selection, key, mode: 'width' })}>
            {t`Match width`}
          </button>
          <button type="button" className="fx-chrome-button" onClick={() => run('element.matchSize', { ids: selection, key, mode: 'height' })}>
            {t`Match height`}
          </button>
          <button type="button" className="fx-chrome-button" onClick={() => run('element.matchSize', { ids: selection, key, mode: 'both' })}>
            {t`Match size`}
          </button>
        </fieldset>
      )}
    </fieldset>
  );
}
