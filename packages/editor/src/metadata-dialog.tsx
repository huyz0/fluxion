// The document details dialog (FR-DOC-006, M9.18): title, description, language, authors, tags and custom key-value pairs over
// `document.updateMeta`, which stamps `modified` with the time the host reads from its clock. Esc or Cancel closes it without a write.

import type { Store } from '@fluxion/core';
import { t } from '@lingui/core/macro';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { buttonsOf, dialogKey } from './dialog-keys.js';
import { type MetadataForm, metadataFields, metadataForm, metadataProblems } from './metadata-form.js';
import type { Execute } from './pointer.js';

/**
 * Props of {@link MetadataDialog}.
 *
 * @public
 */
export type MetadataDialogProps = {
  /** The document store (the record shown). */
  readonly store: Store;
  /** Runs `document.updateMeta`. */
  readonly execute: Execute;
  /** The time to stamp as `modified`, ISO 8601 (the host's clock; default the browser's). */
  readonly now?: () => string;
  /** Close the dialog. */
  readonly onClose: () => void;
};

/**
 * The dialog that edits the document's metadata.
 *
 * @public
 */
export function MetadataDialog(props: MetadataDialogProps): ReactNode {
  const { store, execute, onClose } = props;
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const doc = store.members('byType', 'document')[0];
  const [form, setForm] = useState<MetadataForm>(() => metadataForm(doc === undefined ? undefined : (store.get(doc) as unknown as { [k: string]: unknown })));
  const [error, setError] = useState('');
  useEffect(() => {
    if (dialog.current) dialog.current.querySelector('input')?.focus();
  }, []);
  const problems = metadataProblems(form);
  const set = (patch: Partial<MetadataForm>) => setForm((f) => ({ ...f, ...patch }));
  const save = () => {
    const done = execute('document.updateMeta', { fields: metadataFields(form), modified: (props.now ?? (() => new Date().toISOString()))() });
    if (done.ok) onClose();
    else setError(done.error.message);
  };
  const field = (key: 'title' | 'lang' | 'authors' | 'tags', label: string, hint?: string) => (
    <label className="fx-chrome-formrow">
      {label}
      <input
        type="text"
        value={form[key]}
        aria-describedby={hint === undefined ? undefined : `${id}-${key}`}
        onChange={(e) => set({ [key]: e.target.value })}
      />
      {hint === undefined ? null : (
        <small id={`${id}-${key}`} className="fx-chrome-hint">
          {hint}
        </small>
      )}
    </label>
  );
  return (
    <div
      ref={dialog}
      className="fx-chrome-picker fx-chrome-metadata"
      role="dialog"
      aria-modal="true"
      aria-label={t`Document details`}
      onKeyDown={(e) => dialogKey(e, onClose)}
    >
      <h2 className="fx-chrome-heading">{t`Document details`}</h2>
      {field('title', t`Title`)}
      <label className="fx-chrome-formrow">
        {t`Description`}
        <textarea className="fx-chrome-textbox" value={form.description} rows={3} onChange={(e) => set({ description: e.target.value })} />
      </label>
      {field('lang', t`Language`, t`A language tag such as en or pt-BR`)}
      {problems.lang === undefined ? null : <p role="alert">{t`Language: ${problems.lang}.`}</p>}
      {field('authors', t`Authors`, t`Separate names with commas`)}
      {field('tags', t`Tags`, t`Separate tags with commas`)}
      <fieldset className="fx-chrome-formrow">
        <legend>{t`Custom fields`}</legend>
        {form.custom.map((c, i) => (
          // the rows have no identity but their place: a row is edited or removed where it is
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={i} className="fx-chrome-customrow">
            <input
              type="text"
              className="fx-chrome-textbox"
              aria-label={t`Custom field ${i + 1} name`}
              value={c.key}
              onChange={(e) => set({ custom: form.custom.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)) })}
            />
            <input
              type="text"
              className="fx-chrome-textbox"
              aria-label={t`Custom field ${i + 1} value`}
              value={c.value}
              onChange={(e) => set({ custom: form.custom.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}
            />
            <button
              type="button"
              className="fx-chrome-button"
              aria-label={t`Remove custom field ${i + 1}`}
              onClick={() => set({ custom: form.custom.filter((_, k) => k !== i) })}
            >
              {t`Remove`}
            </button>
          </div>
        ))}
        <button type="button" className="fx-chrome-button" onClick={() => set({ custom: [...form.custom, { key: '', value: '' }] })}>
          {t`Add a custom field`}
        </button>
        {problems.custom === undefined ? null : <p role="alert">{problems.custom}.</p>}
      </fieldset>
      {error === '' ? null : <p role="alert">{error}</p>}
      <div className="fx-chrome-actions">
        <button type="button" className="fx-chrome-button" disabled={Object.keys(problems).length > 0} onClick={save}>
          {t`Save`}
        </button>
        <button type="button" className="fx-chrome-button" onClick={onClose}>
          {t`Cancel`}
        </button>
      </div>
    </div>
  );
}
