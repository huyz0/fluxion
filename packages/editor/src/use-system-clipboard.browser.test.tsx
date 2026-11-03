// The editor's clipboard chords and the focus (FR-EDT-007, NFR-PORT-001, M18.144): a chord goes through the catcher from the canvas, the page or a
// plain control (the only way a paste from another document gets in on WebKit), and leaves alone the focus of a control marked data-fx-keeps-focus,
// so its blur handler (the source view's Reload banner applying the waiting text) does not run.

import { createCore } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { act, type JSX, StrictMode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ClipboardPayload, copyPayload, createClipboard } from './clipboard.js';
import { CHORD_WAIT_MS } from './clipboard-chord.js';
import { payloadJson, payloadText } from './clipboard-format.js';
import { SHARE_CHANNEL } from './clipboard-share.js';
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
  it('FR-EDT-007, NFR-PORT-001: a chord pressed as soon as the editor is committed, before any passive effect, is routed through the catcher (M18.257)', async () => {
    let routed: boolean | undefined;
    // runs in the same commit as the editor, after its layout effects and before its passive ones: the earliest a key can reach a shown editor
    function Early(): null {
      useLayoutEffect(() => {
        chord(host.querySelector('[data-testid="canvas"]') as Element, 'v');
        routed = isCatcher();
      }, []);
      return null;
    }
    await act(async () =>
      root.render(
        <>
          <Harness onBlur={nothing} />
          <Early />
        </>,
      ),
    );
    expect(routed).toBe(true);
  });

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

/** A copy of two shapes and their connector (no text: what the copy puts on text/plain is empty). */
function shapesPayload(): ClipboardPayload {
  const b = documentBuilder({ seed: 7 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0, w: 50, h: 50 });
  const c = b.rect(s, { x: 100, y: 0, w: 50, h: 50 });
  const line = b.connect(a, c);
  const made = copyPayload(createCore(b.build()).store, [a, c, line], { docId: 'doc', screen: s });
  if (made === undefined) throw new Error('nothing copied');
  return made;
}

describe('a paste that carries only text/plain (FR-EDT-007, NFR-PORT-001, M18.242)', () => {
  const copied = shapesPayload();
  const own = createClipboard();
  /** The editor commands: a copy holds the shapes, a paste is recorded with what the clipboard held. */
  const commands: string[] = [];
  const command = (id: string) => {
    commands.push(id === 'clipboard.paste' ? `paste ${own.get() === undefined ? 'nothing' : own.get()?.records.length}` : id);
    if (id === 'clipboard.copy') own.adopt(copied, payloadJson(copied));
    return true;
  };
  function Page(): JSX.Element {
    useSystemClipboard({ clipboard: own, session, run: command, paused: false, place, notify: nothing });
    return <main className="fx-chrome-canvas" tabIndex={-1} data-testid="canvas" />;
  }
  const event = (type: 'copy' | 'paste', data: DataTransfer) =>
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
  const textOnly = (text: string) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    return data;
  };
  afterEach(() => {
    commands.length = 0;
  });

  it('FR-EDT-007 NFR-PORT-001: a paste whose only type is the text the copy put there pastes that copy, and other text is still text', async () => {
    await act(async () => root.render(<Page />));
    (host.querySelector('[data-testid="canvas"]') as HTMLElement).focus();
    const data = new DataTransfer();
    event('copy', data);
    expect(commands).toEqual(['clipboard.copy']);
    expect(data.getData('text/plain')).toBe(payloadText(copied));
    // WebKit 26.5 keeps only text/plain: the custom type and the HTML arrive empty
    const pasted = textOnly(payloadText(copied));
    expect(event('paste', pasted)).toBe(false);
    expect(commands).toEqual(['clipboard.copy', `paste ${copied.records.length}`]);
    // text that is not the copy's is placed as text, as before
    event('paste', textOnly('Hello'));
    await new Promise((done) => setTimeout(done, CHORD_WAIT_MS * 3));
    expect(commands).toEqual(['clipboard.copy', `paste ${copied.records.length}`]);
    expect(placed.length).toBe(1);
    // a file on the clipboard is not the copy
    const file = textOnly('');
    file.items.add(new File(['x'], 'x.bin', { type: 'application/octet-stream' }));
    event('paste', file);
    expect(commands).toEqual(['clipboard.copy', `paste ${copied.records.length}`]);
    // nor is a clipboard with HTML: the engine drops the HTML with the custom type, so this is another application's
    const html = textOnly(payloadText(copied));
    html.setData('text/html', '<p>other</p>');
    event('paste', html);
    expect(commands).toEqual(['clipboard.copy', `paste ${copied.records.length}`]);
  });

  it('FR-EDT-007 NFR-PORT-001: a copy made in another page of the origin is pasted from text/plain alone, in a page opened after it', async () => {
    // another editor page: it copied before this one opened, and answers this one's ask
    const other = new BroadcastChannel(SHARE_CHANNEL);
    const at = Date.now();
    other.onmessage = (e: MessageEvent) => {
      if ((e.data as { ask?: boolean }).ask === true) other.postMessage({ copy: { json: payloadJson(copied), text: payloadText(copied), at } });
    };
    const fresh = createClipboard();
    const pastes: string[] = [];
    function Opened(): JSX.Element {
      useSystemClipboard({
        clipboard: fresh,
        session,
        run: (id) => {
          pastes.push(`${id} ${fresh.get()?.records.length ?? 'nothing'}`);
          return true;
        },
        paused: false,
        place,
        notify: nothing,
      });
      return <main className="fx-chrome-canvas" tabIndex={-1} data-testid="canvas" />;
    }
    await act(async () => root.render(<Opened />));
    (host.querySelector('[data-testid="canvas"]') as HTMLElement).focus();
    // the answer arrives as a message, a task later
    await new Promise((done) => setTimeout(done, 50));
    event('paste', textOnly(payloadText(copied)));
    other.close();
    expect(pastes).toEqual([`clipboard.paste ${copied.records.length}`]);
    expect(fresh.get()?.records.length).toBe(copied.records.length);
  });

  it('FR-EDT-007: under StrictMode (mounted, unmounted, mounted again) a copy is still the editor’s and still reaches the other pages', async () => {
    const other = new BroadcastChannel(SHARE_CHANNEL);
    const heard: unknown[] = [];
    other.onmessage = (e: MessageEvent) => heard.push(e.data);
    await act(async () =>
      root.render(
        <StrictMode>
          <Page />
        </StrictMode>,
      ),
    );
    (host.querySelector('[data-testid="canvas"]') as HTMLElement).focus();
    // not prevented would mean the browser's own copy replaced the payload
    expect(event('copy', new DataTransfer())).toBe(false);
    await new Promise((done) => setTimeout(done, 50));
    other.close();
    expect(heard).toContainEqual({ copy: { json: payloadJson(copied), text: payloadText(copied), at: expect.any(Number) } });
  });
});
