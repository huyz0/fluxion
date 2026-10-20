// The inspector's text boxes: the keys that commit or give back what is typed.
import type { KeyboardEvent } from 'react';

/** Enter commits what is typed, Escape gives it back. */
export function commitKeys(e: KeyboardEvent<HTMLInputElement>, original: string): void {
  if (e.key === 'Enter') e.currentTarget.blur();
  else if (e.key === 'Escape') {
    e.currentTarget.value = original;
    e.currentTarget.blur();
  }
}
