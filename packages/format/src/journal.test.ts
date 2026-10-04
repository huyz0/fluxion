import type { AnyRecord, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { encodeDiff, JOURNAL_MAX_BYTES, JOURNAL_MAX_ENTRIES, type JournalEntry, needsCompaction, readEntry, replay, serializeEntry } from './journal.js';

const id = (s: string) => s as RecordId;
const record = (name: string, extra: object = {}): AnyRecord => ({ id: id(name), type: 'element', kind: 'shape', ...extra }) as AnyRecord;
const diff = (puts: [string, AnyRecord][], deletes: string[] = []) => ({
  puts: new Map(puts.map(([k, after]) => [k, { after }])),
  deletes: new Map(deletes.map((k) => [k, record(k)])),
});
const stamp = (seq: number) => ({ seq, rev: seq * 10, at: `2026-10-04T10:00:0${seq}.000Z` });

describe('encoding a change', () => {
  it('FR-FIL-007: an entry holds the whole record after the change, ids in order, whatever order the store gave them', () => {
    const a = encodeDiff(
      diff(
        [
          ['b', record('b', { x: 1 })],
          ['a', record('a')],
        ],
        ['z', 'c'],
      ),
      stamp(1),
    );
    const b = encodeDiff(
      diff(
        [
          ['a', record('a')],
          ['b', record('b', { x: 1 })],
        ],
        ['c', 'z'],
      ),
      stamp(1),
    );
    expect(a).toEqual(b);
    expect(a.puts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(a.deletes).toEqual(['c', 'z']);
    expect(serializeEntry(a)).toBe(serializeEntry(b));
    expect(a).toMatchObject({ seq: 1, rev: 10, at: '2026-10-04T10:00:01.000Z' });
  });

  it('FR-FIL-007: an entry written and read back is the same entry', () => {
    const entry = encodeDiff(diff([['a', record('a', { n: [1, 2, { deep: true }] })]], ['gone']), stamp(3));
    const back = readEntry(serializeEntry(entry));
    expect(back.ok && back.value).toEqual(entry);
  });

  it('NFR-REL-002: text that is not an entry is a reason, never a throw or a half-trusted object', () => {
    const bad = [
      '',
      '{',
      'null',
      '[]',
      '{"seq":1}',
      '{"seq":1.5,"rev":1,"at":"t","puts":[],"deletes":[]}',
      '{"seq":1,"rev":1,"at":"t","puts":[{"id":"a","after":{"id":"b","type":"element"}}],"deletes":[]}',
      '{"seq":1,"rev":1,"at":"t","puts":[{"id":"a","after":{"id":"a"}}],"deletes":[]}',
      '{"seq":1,"rev":1,"at":"t","puts":[{"id":"a"}],"deletes":[]}',
      '{"seq":1,"rev":1,"at":"t","puts":[],"deletes":[1]}',
      '{"seq":1,"rev":1,"at":"t","puts":{},"deletes":[]}',
      // a record named twice: written twice, or written and removed
      '{"seq":1,"rev":1,"at":"t","puts":[{"id":"a","after":{"id":"a","type":"element"}},{"id":"a","after":{"id":"a","type":"element"}}],"deletes":[]}',
      '{"seq":1,"rev":1,"at":"t","puts":[{"id":"a","after":{"id":"a","type":"element"}}],"deletes":["a"]}',
      '{"seq":1,"rev":1,"at":"t","puts":[],"deletes":["a","a"]}',
    ];
    for (const text of bad) {
      const r = readEntry(text);
      expect(r.ok, text).toBe(false);
      expect(r.ok ? '' : r.reason, text).not.toBe('');
    }
    // text cut anywhere is never an entry that claims more than it had
    const whole = serializeEntry(encodeDiff(diff([['a', record('a')]], ['b']), stamp(1)));
    for (let cut = 0; cut < whole.trimEnd().length; cut++) expect(readEntry(whole.slice(0, cut)).ok, `cut ${cut}`).toBe(false);
  });
});

describe('replaying the journal', () => {
  const base = { records: { a: record('a'), b: record('b', { v: 0 }) }, seq: 0, rev: 0 };
  const entries: JournalEntry[] = [
    encodeDiff(
      diff([
        ['b', record('b', { v: 1 })],
        ['c', record('c')],
      ]),
      stamp(1),
    ),
    encodeDiff(diff([['d', record('d')]], ['a']), stamp(2)),
    encodeDiff(diff([['b', record('b', { v: 2 })]], ['c']), stamp(3)),
  ];

  it('FR-FIL-007: entries applied in order rebuild the records after the last change', () => {
    const r = replay(base, entries);
    expect(r.applied).toBe(3);
    expect(r.stopped).toBeUndefined();
    expect(r.last).toEqual({ seq: 3, rev: 30 });
    expect(Object.keys(r.records).sort()).toEqual(['b', 'd']);
    expect((Reflect.get(r.records, 'b') as unknown as { v: number }).v).toBe(2);
    // the base is not changed
    expect(Object.keys(base.records)).toEqual(['a', 'b']);
  });

  it('FR-FIL-007: a checkpoint plus the entries after it is the same as replaying from the start', () => {
    const mid = replay(base, entries.slice(0, 2));
    const finish = replay({ records: mid.records, seq: mid.last.seq, rev: mid.last.rev }, entries.slice(2));
    expect(finish.records).toEqual(replay(base, entries).records);
    // entries the checkpoint already holds are skipped, not applied twice
    const again = replay({ records: mid.records, seq: 2, rev: 20 }, entries);
    expect(again.applied).toBe(1);
    expect(again.skipped).toBe(2);
    expect(again.records).toEqual(finish.records);
  });

  it('FR-FIL-009: a gap stops the replay at the work before it and says where and how much was dropped', () => {
    const torn = [entries[0] as JournalEntry, entries[2] as JournalEntry];
    const r = replay(base, torn);
    expect(r.applied).toBe(1);
    expect(r.last.seq).toBe(1);
    expect(r.stopped).toEqual({ seq: 3, reason: 'entry 2 is missing', dropped: 1 });
    expect(Object.keys(r.records).sort()).toEqual(['a', 'b', 'c']);
    // nothing applies when the very first entry is not the next one
    const none = replay(base, [entries[1] as JournalEntry]);
    expect(none.applied).toBe(0);
    expect(none.stopped?.dropped).toBe(1);
  });

  it('NFR-SEC-001: record ids that are names on every object (__proto__, constructor) are ordinary keys and change nothing else', () => {
    const hostile = encodeDiff(
      diff(
        [
          ['__proto__', record('__proto__', { polluted: true })],
          ['constructor', record('constructor')],
        ],
        ['toString'],
      ),
      stamp(1),
    );
    const text = serializeEntry(hostile);
    const read = readEntry(text);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const r = replay({ records: { toString: record('toString') }, seq: 0, rev: 0 }, [read.value]);
    expect(Object.keys(r.records).sort()).toEqual(['__proto__', 'constructor']);
    expect((Reflect.get(r.records, '__proto__') as unknown as { polluted?: boolean }).polluted).toBe(true);
    // nothing leaked to the objects every lookup inherits from
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(r.records)).toBeNull();
    // and a base that has such an id keeps it
    const kept = replay({ records: JSON.parse('{"__proto__":{"id":"__proto__","type":"x"}}') as { [id: string]: AnyRecord }, seq: 0, rev: 0 }, []);
    expect(Object.keys(kept.records)).toEqual(['__proto__']);
  });

  it('FR-FIL-007: an empty journal changes nothing', () => {
    const r = replay(base, []);
    expect(r).toEqual({ records: base.records, applied: 0, skipped: 0, last: { seq: 0, rev: 0 } });
  });
});

describe('when the journal is folded into a checkpoint', () => {
  it('FR-FIL-007: at 200 entries or 2 MB, not before', () => {
    expect(JOURNAL_MAX_ENTRIES).toBe(200);
    expect(JOURNAL_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(needsCompaction({ entries: 199, bytes: JOURNAL_MAX_BYTES - 1 })).toBe(false);
    expect(needsCompaction({ entries: 200, bytes: 0 })).toBe(true);
    expect(needsCompaction({ entries: 1, bytes: JOURNAL_MAX_BYTES })).toBe(true);
  });
});
