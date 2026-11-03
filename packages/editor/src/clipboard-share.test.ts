// The editor's last copy shared between its pages (FR-EDT-007, NFR-PORT-001, ADR-0020, M18.242).
import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_CHARS } from './clipboard-format.js';
import { clipboardShare, type ShareChannel, sameText } from './clipboard-share.js';

/** A bus of channels: what one posts, every other one hears (as a BroadcastChannel). */
function bus() {
  const channels: { listeners: Set<(e: MessageEvent) => void>; closed: boolean }[] = [];
  const deliver = (from: (typeof channels)[number], message: unknown) => {
    const to = channels.filter((other) => other !== from && !other.closed);
    for (const l of to.flatMap((other) => [...other.listeners])) l({ data: structuredClone(message) } as MessageEvent);
  };
  const open = (): ShareChannel & { readonly sent: unknown[] } => {
    const self = { listeners: new Set<(e: MessageEvent) => void>(), closed: false };
    channels.push(self);
    const sent: unknown[] = [];
    return {
      sent,
      postMessage(message) {
        sent.push(message);
        deliver(self, message);
      },
      addEventListener: (_type, l) => self.listeners.add(l),
      removeEventListener: (_type, l) => self.listeners.delete(l),
      close: () => {
        self.closed = true;
      },
    };
  };
  return { open };
}

describe('the editor pages share their newest copy (FR-EDT-007, ADR-0020)', () => {
  it('FR-EDT-007 NFR-PORT-001: a copy is known to the pages open then and to a page opened after it, and the newest copy wins', () => {
    let clock = 100;
    const now = () => clock;
    const b = bus();
    const first = clipboardShare(b.open(), now);
    const second = clipboardShare(b.open(), now);
    expect(first.latest()).toBeUndefined();
    first.copied('{"a":1}', 'A');
    expect(second.latest()).toEqual({ json: '{"a":1}', text: 'A', at: 100 });
    // a page opened after the copy asks, and an open page answers with its newest
    const third = clipboardShare(b.open(), now);
    expect(third.latest()).toEqual({ json: '{"a":1}', text: 'A', at: 100 });
    clock = 200;
    third.copied('{"b":2}', 'B');
    expect([first.latest()?.text, second.latest()?.text, third.latest()?.text]).toEqual(['B', 'B', 'B']);
    // an older copy arriving late does not replace a newer one
    const late = b.open();
    late.postMessage({ copy: { json: '{"old":0}', text: 'old', at: 150 } });
    expect(first.latest()?.text).toBe('B');
    // a page that went away hears nothing more
    first.dispose();
    clock = 300;
    second.copied('{"c":3}', 'C');
    expect(first.latest()?.text).toBe('B');
    expect(third.latest()?.text).toBe('C');
  });

  it('FR-EDT-007 NFR-SEC-001: what does not have the shape of a copy or exceeds a payload is ignored', () => {
    const b = bus();
    const own = b.open();
    const page = clipboardShare(own, () => 1);
    const other = b.open();
    for (const copy of [
      null,
      'x',
      { json: 1, text: '', at: 1 },
      { json: '{}', text: 2, at: 1 },
      { json: '{}', text: '', at: Number.NaN },
      { json: 'x'.repeat(MAX_PAYLOAD_CHARS + 1), text: '', at: 2 },
      { json: '{}', text: 'x'.repeat(MAX_PAYLOAD_CHARS + 1), at: 2 },
    ])
      other.postMessage({ copy });
    other.postMessage(null);
    other.postMessage({ other: true });
    expect(page.latest()).toBeUndefined();
    // asked with nothing copied, a page does not answer: it only asked once itself
    other.postMessage({ ask: true });
    expect(own.sent).toEqual([{ ask: true }]);
  });

  it('FR-EDT-007 NFR-SEC-001: this page’s next copy always replaces what it heard, whatever the other clock said, and only a copy’s maker answers an ask', () => {
    const b = bus();
    const a = b.open();
    const first = clipboardShare(a, () => 10);
    const c = b.open();
    const second = clipboardShare(c, () => 20);
    const other = b.open();
    other.postMessage({ copy: { json: '{"far":1}', text: 'far', at: 1e308 } });
    expect(first.latest()?.text).toBe('far');
    first.copied('{"mine":1}', 'mine');
    expect(first.latest()).toEqual({ json: '{"mine":1}', text: 'mine', at: 10 });
    expect(second.latest()?.text).toBe('far');
    // a page that opens asks: the first page made the newest copy it knows and answers; the second only heard of one and stays quiet
    clipboardShare(b.open(), () => 30);
    expect(a.sent).toEqual([{ ask: true }, { copy: { json: '{"mine":1}', text: 'mine', at: 10 } }, { copy: { json: '{"mine":1}', text: 'mine', at: 10 } }]);
    expect(c.sent).toEqual([{ ask: true }]);
  });

  it('FR-EDT-007: a copy is not lost to a channel closed under it', () => {
    const closed: ShareChannel = {
      postMessage: () => {
        throw new DOMException('Channel is closed', 'InvalidStateError');
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      close: () => undefined,
    };
    const page = clipboardShare(closed, () => 1);
    page.copied('{}', '');
    expect(page.latest()?.json).toBe('{}');
  });

  it('FR-EDT-007: without a channel only the page’s own copies are known', () => {
    const page = clipboardShare(undefined, () => 5);
    page.copied('{}', '');
    expect(page.latest()).toEqual({ json: '{}', text: '', at: 5 });
    page.dispose();
  });

  it('FR-EDT-007: the pasted text is the copied text whatever its line ends', () => {
    expect(sameText('a\r\nb\rc', 'a\nb\nc')).toBe(true);
    expect(sameText('', '')).toBe(true);
    expect(sameText('a', 'b')).toBe(false);
    expect(sameText('a ', 'a')).toBe(false);
  });
});
