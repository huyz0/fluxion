import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createStreamSplitter, type ScreenBlock, type SplitOutput } from './split.js';
import { STREAM_TEXTS } from './stream.fixture.js';

type Run = { readonly header: string | undefined; readonly screens: readonly ScreenBlock[]; readonly tail: string | undefined };

/** Feed `text` in `chunks` (cut sizes, cycled), end it; every update on the way is kept. */
function feed(text: string, sizes: readonly number[]): { run: Run; steps: { consumed: number; out: SplitOutput }[] } {
  const splitter = createStreamSplitter();
  const steps: { consumed: number; out: SplitOutput }[] = [];
  let at = 0;
  for (let i = 0; at < text.length; i++) {
    const size = Math.max(1, sizes[i % sizes.length] ?? 1);
    const from = at;
    at = Math.min(text.length, at + size);
    steps.push({ consumed: at, out: splitter.push(text.slice(from, at)) });
  }
  steps.push({ consumed: text.length, out: splitter.end() });
  return {
    run: {
      header: steps.find((s) => s.out.header !== undefined)?.out.header,
      screens: steps.flatMap((s) => s.out.screens),
      tail: steps.find((s) => s.out.tail !== undefined)?.out.tail,
    },
    steps,
  };
}
const whole = (text: string) => feed(text, [text.length || 1]).run;
const joined = (r: Run) => (r.header ?? '') + r.screens.map((s) => s.text).join('') + (r.tail ?? '');
const firstLine = (s: string) => s.slice(0, s.indexOf('\n') + 1 || s.length);
const ids = (r: Run) => r.screens.map((s) => /- id: (\S+)/.exec(s.text)?.[1]);

describe('stream splitter', () => {
  it('FR-AI-010: the checkout example splits into its header and four screens, each from its item line to the next item', () => {
    const r = whole(STREAM_TEXTS['checkout'] as string);
    expect(r.header?.endsWith('\nscreens:\n')).toBe(true);
    expect(ids(r)).toEqual(['intro', 'arch', 'pay-detail', 'data-model']);
    expect(r.screens.every((s) => s.text.startsWith('  - id: '))).toBe(true);
    expect(r.screens[1]?.text).toContain('- web -> api: HTTPS');
    expect(r.screens[1]?.text).not.toContain('- id: pay-detail');
    expect(r.tail).toBeUndefined();
  });

  it('FR-AI-010: items at column 0, deep indents and CRLF line ends split the same way', () => {
    expect(ids(whole(STREAM_TEXTS['screens at column 0'] as string))).toEqual(['one', 'two']);
    expect(ids(whole(STREAM_TEXTS['four-space indent'] as string))).toEqual(['one', 'two']);
    expect(ids(whole(STREAM_TEXTS['crlf'] as string))).toEqual(['one', 'two']);
    expect(whole(STREAM_TEXTS['crlf'] as string).screens[1]?.text.endsWith('b: { shape: rect }')).toBe(true);
  });

  it('FR-AI-010: a quoted top-level key at column 0 after the screens starts the tail, never a screen, at any indent and chunk size', () => {
    for (const indent of ['  ', '']) {
      for (const key of ['"uses": [basic]\n', "'title' : T\n"]) {
        const text = `flux: 1\nscreens:\n${indent}- id: one\n${indent}  nodes: {}\n${key}`;
        for (const size of [1, 7, text.length]) {
          const r = feed(text, [size]).run;
          expect(ids(r), key).toEqual(['one']);
          expect(r.tail, key).toBe(key);
          expect(joined(r)).toBe(text);
        }
      }
    }
  });

  it('FR-AI-010: comments and blanks stay in the block they appear in, and a dashed line deeper than the item does not start a screen', () => {
    const r = whole(STREAM_TEXTS['comments, blanks and a dashed note'] as string);
    expect(ids(r)).toEqual(['one', 'two']);
    expect(r.header?.endsWith('screens:   # the screens\n')).toBe(true);
    expect(r.screens[0]?.text.startsWith('\n  # first\n  - id: one\n')).toBe(true);
    expect(r.screens[0]?.text).toContain('- id: not-a-screen');
    expect(r.screens[0]?.text.endsWith('\n  # second, after a blank line\n\n')).toBe(true);
    expect(r.screens[1]?.text).toContain('- b -> c: "- id: x"');
  });

  it('FR-AI-010: a top-level key after the screens is the tail, and the last screen ends before it', () => {
    const r = whole(STREAM_TEXTS['a key after the screens'] as string);
    expect(ids(r)).toEqual(['one', 'two']);
    expect(r.screens[1]?.text.endsWith('b: { shape: rect }\n')).toBe(true);
    expect(r.tail).toBe('settings: { autoplay: false }\n');
  });

  it('FR-AI-010: a text with no screens key, or with the screens as a flow list, is all header', () => {
    expect(whole('flux: 1\nscreens: [ { id: a } ]\n')).toEqual({ header: 'flux: 1\nscreens: [ { id: a } ]\n', screens: [], tail: undefined });
    expect(whole('')).toEqual({ header: '', screens: [], tail: undefined });
    expect(whole('flux: 1\nscreens:\n# only a comment\n')).toEqual({ header: 'flux: 1\nscreens:\n', screens: [], tail: '# only a comment\n' });
  });

  it('FR-AI-010: fed line by line, a screen is emitted when the next item line is complete, never before, and the last one at end()', () => {
    const text = STREAM_TEXTS['checkout'] as string;
    const splitter = createStreamSplitter();
    const emitted: string[] = [];
    const lines = text.match(/[^\n]*\n/g) as string[];
    const log: { line: string; count: number }[] = [];
    for (const line of lines) {
      emitted.push(...splitter.push(line).screens.map((s) => s.text));
      log.push({ line, count: emitted.length });
    }
    // 3 of the 4 screens are out before end(): each when the following `- id:` line arrived
    expect(emitted).toHaveLength(3);
    expect(log.find((l) => l.line.startsWith('  - id: arch'))?.count).toBe(1);
    expect(log.find((l) => l.line.startsWith('  - id: pay-detail'))?.count).toBe(2);
    expect(log.find((l) => l.line.startsWith('  - id: data-model'))?.count).toBe(3);
    expect(log.filter((l) => l.count === 0).every((l) => !l.line.startsWith('  - id: arch'))).toBe(true);
    expect(splitter.end().screens.map((s) => s.text.split('\n')[0])).toEqual(['  - id: data-model']);
  });

  it('FR-AI-010: a line is held back until its newline: single characters give the same pieces and nothing early', () => {
    for (const text of Object.values(STREAM_TEXTS)) {
      const a = feed(text, [1]);
      expect(a.run).toEqual(whole(text));
      // before the end, a block is out only once the next item's line is complete (its newline received)
      const run = whole(text);
      // a block closes when the line that follows it (the next item, or the first line of the tail) is complete
      const starts = [
        ...run.screens.slice(1).map((b) => b.offset + firstLine(b.text).length),
        ...(run.tail === undefined ? [] : [text.length - run.tail.length + firstLine(run.tail).length]),
      ];
      let out = 0;
      for (const step of a.steps.slice(0, -1)) {
        out += step.out.screens.length;
        expect(out).toBe(starts.filter((end) => end <= step.consumed).length);
      }
    }
  });

  it('FR-AI-010: blocks carry their offset and line in the whole input', () => {
    for (const text of Object.values(STREAM_TEXTS)) {
      for (const b of whole(text).screens) {
        expect(text.slice(b.offset, b.offset + b.text.length)).toBe(b.text);
        expect(text.slice(0, b.offset).split('\n').length).toBe(b.line);
      }
    }
  });

  it('FR-AI-010: the header, the screens and the tail join back to the input, in any chunking, with every screen emitted once', () => {
    const texts = Object.values(STREAM_TEXTS);
    fc.assert(
      fc.property(fc.constantFrom(...texts), fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 8 }), (text, sizes) => {
        const { run, steps } = feed(text, sizes);
        expect(joined(run)).toBe(text);
        expect(run).toEqual(whole(text));
        expect(steps.filter((s) => s.out.header !== undefined)).toHaveLength(1);
        expect(new Set(run.screens.map((s) => s.offset)).size).toBe(run.screens.length);
      }),
      { seed: 12018, numRuns: 150 },
    );
  });

  it('FR-AI-010: a splitter that has ended refuses more input', () => {
    const s = createStreamSplitter();
    s.end();
    expect(() => s.push('x')).toThrow('ended');
  });
});
