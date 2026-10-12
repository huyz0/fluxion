// The Source tab of the left panel (FR-EDT-022, ADR-0032). CodeMirror and the compiler are a lazy chunk: this file is all the initial chunk holds
// of the source view, a skeleton shown while `loadSourceView` resolves. Do not import `source-view/` statically from anywhere but tests.
import type { CoreRegistries, Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ComponentType, lazy, type ReactNode, Suspense } from 'react';
import type { Execute } from './pointer.js';
import type { SourceViewProps } from './source-view/source-view.js';

/** Load the source view's chunk (the code editor, the FluxScript language and the compiler). */
export const loadSourceView = async (): Promise<{ default: ComponentType<SourceViewProps> }> => ({
  default: (await import('./source-view/source-view.js')).SourceView,
});

const SourceView = lazy(loadSourceView);

/** Props of {@link SourceTab}. */
export type SourceTabProps = {
  /** The document store. */
  readonly store: Store;
  /** Runs a command: every apply of the text is one `document.applyRecords`. */
  readonly execute: Execute;
  /** The registries the text is compiled against: shapes, layouts and themes. */
  readonly registries: CoreRegistries;
  /** The screen shown on the canvas. */
  readonly screenId: RecordId | undefined;
  /** Escape in the editor: put the focus back on the tab. */
  readonly onEscape?: () => void;
};

/** The Source tab: a skeleton, then the source view. */
export function SourceTab(props: SourceTabProps): ReactNode {
  return (
    <Suspense
      fallback={
        <p className="fx-chrome-placeholder" role="status" aria-busy="true">
          {t`Loading the source view…`}
        </p>
      }
    >
      <SourceView {...props} />
    </Suspense>
  );
}
