// The editor's clipboard chords and the focus (FR-EDT-007, NFR-PORT-001, M18.144): a chord goes through the catcher from the canvas, the page or a
// plain control (the only way a paste from another document gets in on WebKit), and leaves alone the focus of a control marked data-fx-keeps-focus,
// so its blur handler (the source view's Reload banner applying the waiting text) does not run.
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClipboard } from './clipboard.js';
import { createSession } from './session.js';
import { useSystemClipboard } from './use-system-clipboard.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

const session = createSession('doc');
const clipboard = createClipboard();
const run = () => false;
const nothing = () => undefined;

function Harness(props: { readonly onBlur: () => void }): JSX.Element {
  useSystemClipboard({ clipboard, session, run, paused: false, place: nothing, notify: nothing });
  return (
    <>
      <main className="fx-chrome-canvas" tabIndex={-1} data-testid="canvas" />
      <div data-fx-keeps-focus="">
        <button type="button" data-testid="reload" onBlur={props.onBlur}>
          Reload
        </button>
      </div>
      <button type="button" data-testid="screen">
        Screen 1
      </button>
    </>
  );
}

const chord = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
const isCatcher = () => document.activeElement instanceof HTMLElement && 'fxClipboardCatcher' in document.activeElement.dataset;

describe('clipboard chords and the focus (FR-EDT-007)', () => {
  it('FR-EDT-007: a chord on a focused control marked to keep its focus leaves it alone, so its blur handler does not run', async () => {
    let blurs = 0;
    await act(async () => root.render(<Harness onBlur={() => blurs++} />));
    const button = host.querySelector<HTMLButtonElement>('[data-testid="reload"]') as HTMLButtonElement;
    button.focus();
    for (const key of ['c', 'x', 'v']) {
      chord(button, key);
      expect(document.activeElement).toBe(button);
    }
    expect(blurs).toBe(0);
  });

  it('FR-EDT-007, NFR-PORT-001: a chord with the canvas, the page or a plain button focused still goes through the catcher', async () => {
    await act(async () => root.render(<Harness onBlur={nothing} />));
    const canvas = host.querySelector<HTMLElement>('[data-testid="canvas"]') as HTMLElement;
    canvas.focus();
    chord(canvas, 'v');
    expect(isCatcher()).toBe(true);
    (document.activeElement as HTMLElement).blur();
    chord(document.body, 'v');
    expect(isCatcher()).toBe(true);
    const screen = host.querySelector<HTMLButtonElement>('[data-testid="screen"]') as HTMLButtonElement;
    screen.focus();
    chord(screen, 'v');
    expect(isCatcher()).toBe(true);
  });
});
