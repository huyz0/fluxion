// The editor's clipboard chords and the focus (FR-EDT-007, NFR-PORT-001, M18.144): a chord goes through the catcher from the canvas, the page or a
// plain control (the only way a paste from another document gets in on WebKit), and leaves alone the focus of a control marked data-fx-keeps-focus,
// so its blur handler (the source view's Reload banner applying the waiting text) does not run.
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClipboard } from './clipboard.js';
import { CHORD_WAIT_MS } from './clipboard-chord.js';
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
  ran.length = 0;
  placed.length = 0;
  act(() => root.unmount());
  document.body.replaceChildren();
});

const session = createSession('doc');
const clipboard = createClipboard();
/** The editor commands run, in order. */
const ran: string[] = [];
const run = (command: string) => {
  ran.push(command);
  return false;
};
const nothing = () => undefined;
/** What a paste placed, as text. */
const placed: string[] = [];
const place = (item: unknown) => {
  placed.push(JSON.stringify(item));
};

function Harness(props: { readonly onBlur: () => void }): JSX.Element {
  useSystemClipboard({ clipboard, session, run, paused: false, place, notify: nothing });
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

  it('FR-EDT-007: with a marked control focused, the editor does no copy, cut or paste: not for the events Firefox raises on the body, nor after the chord wait (M18.227)', async () => {
    let blurs = 0;
    await act(async () => root.render(<Harness onBlur={() => blurs++} />));
    const button = host.querySelector<HTMLButtonElement>('[data-testid="reload"]') as HTMLButtonElement;
    button.focus();
    // WebKit raises no event from the control: nothing is done after the chord wait either
    for (const key of ['c', 'x', 'v']) chord(button, key);
    await new Promise((done) => setTimeout(done, CHORD_WAIT_MS * 3));
    expect(ran).toEqual([]);
    // Firefox raises the events on the body; the paste carries text, which the editor would place
    for (const [key, type] of [
      ['c', 'copy'],
      ['x', 'cut'],
      ['v', 'paste'],
    ] as const) {
      chord(button, key);
      const data = new DataTransfer();
      data.setData('text/plain', 'Hello');
      document.body.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
    }
    await new Promise((done) => setTimeout(done, CHORD_WAIT_MS * 3));
    expect(ran).toEqual([]);
    expect(placed).toEqual([]);
    expect(document.activeElement).toBe(button);
    expect(blurs).toBe(0);
    // the same events with the canvas focused are the editor's
    (host.querySelector('[data-testid="canvas"]') as HTMLElement).focus();
    document.body.dispatchEvent(new ClipboardEvent('cut', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    expect(ran).toEqual(['clipboard.cut']);
    const text = new DataTransfer();
    text.setData('text/plain', 'Hello');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: text, bubbles: true, cancelable: true }));
    // the text is read after the event ends
    await new Promise((done) => setTimeout(done, CHORD_WAIT_MS * 3));
    expect(placed.length).toBe(1);
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
