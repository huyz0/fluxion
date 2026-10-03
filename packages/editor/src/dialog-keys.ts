// Keys inside a modal dialog of the editor chrome (the image picker, the keyboard shortcuts): they stay
// in it, so the canvas's shortcuts and undo do not act behind it.
import type { KeyboardEvent } from 'react';

/** The buttons of `dialog`, in order. */
export const buttonsOf = (dialog: HTMLElement): HTMLButtonElement[] => [...dialog.querySelectorAll('button')];

/** The controls of `dialog` that take focus (enabled buttons, inputs, text areas, selects), in order. */
export const focusablesOf = (dialog: HTMLElement): HTMLElement[] => [
  ...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'),
];

/**
 * Keys in the dialog stay in it: Esc closes it, and Tab cycles through its controls. F5 is taken
 * without acting, since it would reload the page and drop the document (M7.5 review F1).
 */
export function dialogKey(e: KeyboardEvent<HTMLElement>, close: () => void): void {
  e.stopPropagation();
  if (e.key === 'F5') e.preventDefault();
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab') return;
  const controls = focusablesOf(e.currentTarget);
  const [first, last] = [controls[0], controls.at(-1)];
  const edge = e.shiftKey ? first : last;
  if (document.activeElement !== edge) return;
  e.preventDefault();
  (e.shiftKey ? last : first)?.focus();
}
