import type { ConnectorDef } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { embeddedConnectors, savedConnectorEntries, usedConnectorTypes } from './connector-entries.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

const def = (id: string): ConnectorDef => ({ id: id as ConnectorDef['id'], router: 'orthogonal', decoration: { kind: 'double', gap: 3 } });
const DEFS = new Map([def('lines:wavy'), def('lines:double'), def('net:wire')].map((d) => [d.id as string, d]));

function doc() {
  const b = documentBuilder({ seed: 7 });
  const s = b.screen();
  const [a, c, e] = [0, 1, 2].map((i) => b.rect(s, { x: i * 200, y: 0, w: 80, h: 50 })) as [never, never, never];
  b.connect(a, c, { route: 'lines:wavy' });
  b.connect(c, e, { route: 'net:wire' });
  b.connect(a, e, { route: 'net:wire' });
  b.connect(a, e, { route: 'other:unknown' });
  b.connect(c, a, { route: 'orthogonal' });
  return b.build();
}

describe('pack connector types in saved entries (FR-CON-010, FR-LIB-009)', () => {
  it('FR-LIB-009: a save embeds the definitions of exactly the pack connector types the document uses, one entry per pack', () => {
    expect(usedConnectorTypes(doc())).toEqual(['lines:wavy', 'net:wire', 'other:unknown']);
    const known = (t: string) => DEFS.get(t);
    const entries = savedConnectorEntries(
      doc(),
      new Map([
        ['plugins/x@1/player.js', encodeUtf8('x')],
        ['connectors/old.json', encodeUtf8('{}')],
      ]),
      known,
    );
    // a pack no longer used is dropped; `other` has no definition and no earlier entry, so nothing is written for it
    expect([...entries.keys()]).toEqual(['plugins/x@1/player.js', 'connectors/lines.json', 'connectors/net.json']);
    const text = decodeUtf8(entries.get('connectors/net.json') as Uint8Array);
    expect(JSON.parse(text)).toEqual({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [def('net:wire')] });
    // canonical: the same definitions give the same bytes
    expect(savedConnectorEntries(doc(), undefined, known).get('connectors/lines.json')).toEqual(entries.get('connectors/lines.json'));
  });

  it('FR-LIB-009: an entry for a pack whose used types the host does not know (refused on open) is kept as it was', () => {
    const refused = encodeUtf8('{"format":"fluxion-connector-defs","formatVersion":"1.1","definitions":[]}');
    const entries = savedConnectorEntries(doc(), new Map([['connectors/net.json', refused]]), (t) => (t === 'lines:wavy' ? DEFS.get(t) : undefined));
    expect(entries.get('connectors/net.json')).toBe(refused);
    expect([...entries.keys()]).toEqual(['connectors/lines.json', 'connectors/net.json']);
  });

  it('FR-CON-010, FR-LIB-009: a pack with known and unknown used types and no earlier entry writes every known definition (cp35 F3)', () => {
    const b = documentBuilder({ seed: 239 });
    const s = b.screen();
    const [a, c] = [0, 1].map((i) => b.rect(s, { x: i * 200, y: 0, w: 80, h: 50 })) as [never, never];
    b.connect(a, c, { route: 'lines:wavy' });
    b.connect(c, a, { route: 'lines:zig' });
    b.connect(a, c, { route: 'lines:double' });
    const entries = savedConnectorEntries(b.build(), undefined, (t) => DEFS.get(t));
    const read = JSON.parse(decodeUtf8(entries.get('connectors/lines.json') as Uint8Array));
    expect(read).toEqual({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [def('lines:double'), def('lines:wavy')] });
  });

  it("FR-CON-010, FR-LIB-009: the earlier entry's definitions of the unknown used types join the known ones; an unused, invalid or repeated one is not carried (cp35 F3)", () => {
    const b = documentBuilder({ seed: 240 });
    const s = b.screen();
    const [a, c] = [0, 1].map((i) => b.rect(s, { x: i * 200, y: 0, w: 80, h: 50 })) as [never, never];
    b.connect(a, c, { route: 'lines:wavy' });
    b.connect(c, a, { route: 'lines:zig' });
    b.connect(a, c, { route: 'lines:bad' });
    for (const route of ['lines:two', 'lines:long', 'lines:line'] as const) b.connect(c, a, { route });
    const zig = { ...def('lines:zig'), decoration: { kind: 'zigzag', amplitude: 4, wavelength: 10 } };
    // refused on open by this host (a newer envelope), but its definitions are valid 1.0 definitions
    const earlier = encodeUtf8(
      JSON.stringify({
        format: 'fluxion-connector-defs',
        formatVersion: '1.1',
        definitions: [
          def('lines:wavy'),
          { id: 'lines:zig', router: 'nope' },
          zig,
          def('lines:gone'),
          { ...zig, name: 'Second zig' },
          { id: 'lines:bad', router: 'orthogonal', decoration: { kind: 'none-such' } },
          // valid 1.0 definitions whose describe registering refuses (two lines, past 160 characters), and one it takes
          { ...def('lines:two'), describe: 'two\nlines' },
          { ...def('lines:long'), describe: 'x'.repeat(161) },
          { ...def('lines:line'), describe: 'One line.' },
        ],
      }),
    );
    const known = new Map([['lines:wavy', { ...def('lines:wavy'), name: 'Wavy here' }]]);
    const dropped: [string, readonly string[]][] = [];
    const entries = savedConnectorEntries(
      b.build(),
      new Map([['connectors/lines.json', earlier]]),
      (t) => known.get(t),
      (pack, ids) => dropped.push([pack, ids]),
    );
    const read = JSON.parse(decodeUtf8(entries.get('connectors/lines.json') as Uint8Array));
    // each used unknown type whose earlier definitions were all left out is reported once, sorted (M18.260); zig is not, as
    // its second definition travels, and gone is not used
    expect(dropped).toEqual([['lines', ['lines:bad', 'lines:long', 'lines:two']]]);
    // the host's own definition of a known type wins over the earlier one; zig travels on once (the first valid one, a
    // second would refuse the whole entry); gone is unused, bad not 1.0, two and long would refuse it on registering
    expect(read).toEqual({
      format: 'fluxion-connector-defs',
      formatVersion: '1.0',
      definitions: [{ ...def('lines:line'), describe: 'One line.' }, known.get('lines:wavy'), zig],
    });
  });

  it("FR-CON-010, FR-LIB-009: a save that cannot carry an earlier 1.1 entry's definition reports its id, and a pack it keeps whole reports none (M18.260)", () => {
    const b = documentBuilder({ seed: 260 });
    const s = b.screen();
    const [a, c] = [0, 1].map((i) => b.rect(s, { x: i * 200, y: 0, w: 80, h: 50 })) as [never, never];
    b.connect(a, c, { route: 'lines:wavy' });
    b.connect(c, a, { route: 'lines:newer' });
    // a newer host's 1.1 entry: its definition of lines:newer uses a decoration this 1.0 entry cannot hold
    const earlier = encodeUtf8(
      JSON.stringify({
        format: 'fluxion-connector-defs',
        formatVersion: '1.1',
        definitions: [{ id: 'lines:newer', router: 'orthogonal', decoration: { kind: 'braided', strands: 3 } }],
      }),
    );
    const dropped: [string, readonly string[]][] = [];
    const report = (pack: string, ids: readonly string[]) => dropped.push([pack, ids]);
    const entries = savedConnectorEntries(b.build(), new Map([['connectors/lines.json', earlier]]), (t) => DEFS.get(t), report);
    expect(JSON.parse(decodeUtf8(entries.get('connectors/lines.json') as Uint8Array)).definitions).toEqual([DEFS.get('lines:wavy')]);
    expect(dropped).toEqual([['lines', ['lines:newer']]]);
    // a host that knows none of the pack's used types keeps the entry as it was, so nothing is lost or reported
    dropped.length = 0;
    const kept = savedConnectorEntries(b.build(), new Map([['connectors/lines.json', earlier]]), () => undefined, report);
    expect(kept.get('connectors/lines.json')).toBe(earlier);
    expect(dropped).toEqual([]);
  });

  it('FR-CON-010: reading back gives each pack with its JSON; an entry that is not UTF-8 JSON or is nested reads as nothing to register', () => {
    const entries = savedConnectorEntries(doc(), undefined, (t) => (t === 'lines:wavy' ? DEFS.get(t) : undefined));
    const read = embeddedConnectors(
      new Map([
        ...entries,
        ['connectors/bad.json', encodeUtf8('{"format":')],
        ['connectors/bin.json', new Uint8Array([0xff, 0xfe])],
        ['connectors/deep/x.json', encodeUtf8('{}')],
        ['connectors/readme.txt', encodeUtf8('hi')],
      ]),
    );
    expect(read.map((r) => r.pack)).toEqual(['bad', 'bin', 'lines']);
    expect(read.find((r) => r.pack === 'lines')?.input).toEqual({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions: [def('lines:wavy')] });
    expect(read.filter((r) => r.input === undefined).map((r) => r.pack)).toEqual(['bad', 'bin']);
    expect(embeddedConnectors(undefined)).toEqual([]);
  });
});
