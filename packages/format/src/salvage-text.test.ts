import { describe, expect, it } from 'vitest';
import { recoverTruncated } from './salvage-text.js';

describe('recoverTruncated', () => {
  it('FR-FIL-009: the complete records before the cut are kept, with the version when it came before', () => {
    const text = '{"records":{"a":{"id":"a","n":1},"b":{"id":"b","list":[1,2,{"x":"}"}]},"c":{"id":"c","half":';
    expect(recoverTruncated(text)).toEqual({ records: { a: { id: 'a', n: 1 }, b: { id: 'b', list: [1, 2, { x: '}' }] } } });
    const withVersion = '{"schemaVersion":"1.2","extra":[1,{"k":"v"}],"records":{"a":{"id":"a"}},"tail":';
    expect(recoverTruncated(withVersion)).toEqual({ records: { a: { id: 'a' } }, schemaVersion: '1.2' });
  });

  it('FR-FIL-009: strings with braces, quotes and escapes do not confuse the scanner', () => {
    const text = '{"records":{"a":{"id":"a","t":"he said \\"}{\\" \\\\"},"b":{"id":"b","t":"cut \\"in a str';
    expect(recoverTruncated(text)).toEqual({ records: { a: { id: 'a', t: 'he said "}{" \\' } } });
  });

  it('FR-FIL-009: a number or literal cut short is not taken as complete, and a record that is not JSON stops the scan', () => {
    expect(recoverTruncated('{"records":{"a":{"id":"a"},"b":123')).toEqual({ records: { a: { id: 'a' } } });
    expect(recoverTruncated('{"records":{"a":{"id":"a"},"b":tru')).toEqual({ records: { a: { id: 'a' } } });
    expect(recoverTruncated('{"records":{"a":{"id":"a"},"b":{"id":}}')).toEqual({ records: { a: { id: 'a' } } });
    expect(recoverTruncated('{"records":{"a":{"id":"a"} "b":{"id":"b"}}')).toEqual({ records: { a: { id: 'a' } } });
  });

  it('FR-FIL-009: nothing is recovered from text with no complete record, and the scanner never throws', () => {
    for (const text of ['', '{', '{"records"', '{"records":{', '{"records":{"a":', '[1,2]', 'null', '{"records":[1]}', '{"records":{"a":}}', '}{', '{"a":1,']) {
      expect(recoverTruncated(text), text).toBeUndefined();
    }
    const hostile = `{"records":{"a":${'['.repeat(100000)}`;
    expect(recoverTruncated(hostile)).toBeUndefined();
  });

  it('FR-FIL-009: members after the records are skipped, and a record id repeated keeps the last value', () => {
    expect(recoverTruncated('{"records":{"a":{"v":1},"a":{"v":2}},"z":{"deep":[[[]]]},"schemaVersion":"1.1"}')).toEqual({
      records: { a: { v: 2 } },
      schemaVersion: '1.1',
    });
  });
});
