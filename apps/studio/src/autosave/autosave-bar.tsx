// The status line of autosave (FR-FIL-007): one sentence on whether what the person is doing is kept, and how well.
import type { JSX } from 'react';
import type { AutosaveState } from './document-autosave.js';

/**
 * The sentence for `state`.
 *
 * @public
 */
export function statusText(state: AutosaveState): string {
  const { protection, write } = state;
  if (write.kind === 'failed') return `Autosave failed (${write.message}); trying again in ${Math.round(write.retryInMs / 1000)} s.`; // kind-switch-allow: the autosave's own closed status union
  if (protection === 'unavailable') return 'Autosave is unavailable in this browser: save the file to keep your work.';
  if (write.kind === 'pending') return 'Saving changes on this device…'; // kind-switch-allow: the autosave's own closed status union
  return protection === 'protected'
    ? 'Changes are kept on this device.'
    : 'Changes are kept on this device, but the browser may clear them when storage runs low: save the file to be sure.';
}

/**
 * The status line.
 *
 * @public
 */
export function AutosaveBar(props: { readonly state: AutosaveState | undefined; readonly readOnly: boolean }): JSX.Element {
  const text = props.readOnly ? 'Open in another tab: this one is read-only.' : props.state === undefined ? 'Starting autosave…' : statusText(props.state);
  const bad = props.readOnly || props.state?.write.kind === 'failed' || props.state?.protection === 'unavailable';
  return (
    <span
      role="status"
      data-testid="autosave-status"
      data-state={bad ? 'attention' : 'ok'}
      className="fx-studio-autosave"
      style={{ fontSize: 12, marginInlineStart: 8 }}
    >
      {text}
    </span>
  );
}
