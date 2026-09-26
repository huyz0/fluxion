import type { JSX } from 'react';

/** Props of {@link EmptyState}. */
export interface EmptyStateProps {
  /** Short message shown when a screen has no elements yet. */
  message: string;
}

/**
 * Placeholder the editor shows for an empty screen (the first story, M1.17).
 */
export function EmptyState({ message }: EmptyStateProps): JSX.Element {
  return (
    <section aria-label="Empty screen">
      <p>{message}</p>
    </section>
  );
}
