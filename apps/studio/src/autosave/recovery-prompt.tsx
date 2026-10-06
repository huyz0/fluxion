// The recovery prompt (FR-FIL-007): "Recover unsaved changes", one row per document the last session left unsaved, each with what is in it and
// the choice to recover it or throw it away. Leaving the prompt keeps everything for next time.
import { t } from '@lingui/core/macro';
import type { JSX } from 'react';
import { previewOf, type Recoverable } from './recovery.js';

/** Props of {@link RecoveryPrompt}. */
export type RecoveryPromptProps = {
  /** What can be recovered. */
  readonly items: readonly Recoverable[];
  /** Open `item`'s rebuilt document. */
  readonly onRecover: (item: Recoverable) => void;
  /** Forget `item` for good. */
  readonly onDiscard: (item: Recoverable) => void;
  /** Leave the prompt; nothing is forgotten. */
  readonly onClose: () => void;
};

/** The time as the person reads it. */
const when = (iso: string): string => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString();
};

/**
 * The prompt.
 *
 * @public
 */
export function RecoveryPrompt(props: RecoveryPromptProps): JSX.Element {
  const { items, onRecover, onDiscard, onClose } = props;
  return (
    <dialog open aria-label={t`Recover unsaved changes`} style={{ position: 'fixed', top: 48, zIndex: 10_000, maxWidth: 560, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{t`Recover unsaved changes`}</h2>
      <p>{t`The last session ended with work that was not saved to a file.`}</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((item) => {
          const p = previewOf(item);
          const { screens, records, changes } = p;
          const changed = when(p.updated);
          const screenWord = screens === 1 ? t`screen` : t`screens`;
          const changeWord = changes === 1 ? t`change` : t`changes`;
          return (
            <li key={item.id} style={{ marginBottom: 12 }}>
              <strong>{p.title}</strong>
              <div>{t`Last changed ${changed}: ${screens} ${screenWord}, ${records} records, ${changes} ${changeWord} since it was saved.`}</div>
              {p.warning === undefined ? null : <div role="note">{p.warning}</div>}
              <button type="button" className="fx-chrome-button" onClick={() => onRecover(item)}>
                {t`Recover`}
              </button>{' '}
              <button type="button" className="fx-chrome-button" onClick={() => onDiscard(item)}>
                {t`Discard`}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="fx-chrome-button" onClick={onClose}>
        {t`Not now`}
      </button>
    </dialog>
  );
}
