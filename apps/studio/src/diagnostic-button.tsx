// "Copy diagnostic report" (NFR-OBS-002): one button that puts the report on the clipboard and says so. Nothing is sent anywhere: the person pastes it where they choose.

import type { Store } from '@fluxion/core';
import { FLUX_FORMAT_VERSION } from '@fluxion/format';
import { SCHEMA_VERSION } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type JSX, useState } from 'react';
import { loggedProblems } from './dev-logger.js';
import { diagnosticReport } from './diagnostic-report.js';

const STUDIO_VERSION = '0.0.0';

/** Props of {@link DiagnosticButton}. */
export type DiagnosticButtonProps = {
  /** The open document. */
  readonly store: Store;
  /** Puts text on the clipboard (default the browser's). */
  readonly write?: (text: string) => Promise<void>;
};

/** The button and its status line. */
export function DiagnosticButton(props: DiagnosticButtonProps): JSX.Element {
  const { store, write = (text) => navigator.clipboard.writeText(text) } = props;
  const [said, setSaid] = useState('');
  const copy = () => {
    const text = diagnosticReport({
      versions: { studio: STUDIO_VERSION, schema: String(SCHEMA_VERSION), format: String(FLUX_FORMAT_VERSION) },
      records: store.toDocument().records,
      entries: loggedProblems(),
      userAgent: navigator.userAgent,
    });
    write(text).then(
      () => setSaid(t`Diagnostic report copied.`),
      () => setSaid(t`The diagnostic report could not be copied.`),
    );
  };
  return (
    <span className="fx-studio-diagnostic">
      <button type="button" onClick={copy}>
        {t`Copy diagnostic report`}
      </button>
      <span role="status" style={{ fontSize: 12, marginInlineStart: 6 }}>
        {said}
      </span>
    </span>
  );
}
