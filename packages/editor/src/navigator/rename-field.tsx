// The inline rename field of a screen row (FR-SCR-002, M8.12): Enter commits a changed, non-blank name, Esc or leaving
// the field cancels. Its keys stay in the field (they are not the canvas's shortcuts).
import type { ReactNode } from 'react';

/** Props of {@link RenameField}. */
export type RenameFieldProps = {
  /** The name now shown. */
  readonly label: string;
  /** Commit a new name. */
  readonly onCommit: (name: string) => void;
  /** The field's accessible name (default: `Rename <label>`). */
  readonly name?: string;
  /** Whether a typed text may be committed (default: any non-blank text). */
  readonly accepts?: (text: string) => boolean;
  /** Leave the field. */
  readonly onDone: () => void;
};

/** The field. */
export function RenameField(props: RenameFieldProps): ReactNode {
  const { label, onCommit, onDone, name: given, accepts = (text: string) => text !== '' } = props;
  return (
    <input
      className="fx-chrome-rename"
      aria-label={given ?? `Rename ${label}`}
      defaultValue={label}
      // biome-ignore lint/a11y/noAutofocus: the field exists because the user asked to rename; focus belongs in it
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const text = e.currentTarget.value.trim();
          onDone();
          if (accepts(text) && text !== label) onCommit(text);
        } else if (e.key === 'Escape') onDone();
      }}
      onBlur={onDone}
    />
  );
}
