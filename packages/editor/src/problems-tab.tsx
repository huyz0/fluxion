// The Problems tab (FR-EDT-021, M7.26): the document's live problems, each with the elements it is about (Select) and
// the fix a command can make (Fix). Recomputed when the document changes.
import type { Store } from '@fluxion/core';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo } from 'react';
import type { Execute } from './pointer.js';
import { useRevision } from './present.js';
import { type Problem, problemsOf } from './problems.js';
import type { Session } from './session.js';

/** Props of {@link ProblemsTab}. */
export type ProblemsTabProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection Select sets. */
  readonly session: Session;
  /** Runs a command: Fix goes through it, so it is one undo step. */
  readonly execute: Execute;
};

/** The severity's name, looked up when shown (after i18n is active). */
function severityLabel(severity: Problem['severity']): string {
  return { error: t`Error`, warning: t`Warning`, info: t`Note` }[severity];
}

/** The list of problems; "No problems found." when there are none. */
export function ProblemsTab(props: ProblemsTabProps): ReactNode {
  const { store, session, execute } = props;
  const revision = useRevision(store);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision says the document changed
  const problems = useMemo(() => problemsOf(store.toDocument()), [store, revision]);
  if (problems.length === 0) return <p className="fx-chrome-placeholder">{t`No problems found.`}</p>;
  const fix = (p: Problem) => {
    if (p.fix !== undefined) execute(p.fix.command, p.fix.args);
  };
  return (
    <ul className="fx-chrome-problems" aria-label={t`Problems`}>
      {problems.map((p) => (
        <li key={p.id} className="fx-chrome-problem" data-severity={p.severity}>
          <span className="fx-chrome-problem-text">
            <strong>{severityLabel(p.severity)}:</strong> {p.message}
          </span>
          {p.elements.length === 0 ? null : (
            <button type="button" className="fx-chrome-button" onClick={() => session.selection.set(p.elements)}>
              {t`Select`}
            </button>
          )}
          {p.fix === undefined ? null : (
            <button type="button" className="fx-chrome-button" onClick={() => fix(p)}>
              {p.fix.title}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
