import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basicMarkers } from '@fluxion/pack-basic';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { MARKER_SIZE, markerTrim } from '@fluxion/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { E2E_TIMEOUT, fluxion } from './spawn-bin.js';

const dir = mkdtempSync(join(tmpdir(), 'fluxion-markers-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('the basic pack markers, drawn by the CLI (FR-CON-003, ADR-0017)', { timeout: E2E_TIMEOUT }, () => {
  it('FR-CON-003: every basic pack marker scales with the stroke width and trims the path under it', () => {
    // one straight connector per marker and stroke width, 200 px long, the marker at its end
    const b = documentBuilder({ seed: 5360 });
    b.screen({ size: { w: 400, h: 400 } });
    const cases = basicMarkers.flatMap((def, k) =>
      [2, 4].map((width, j) => {
        const y = 20 * (2 * k + j) + 10;
        return { def, width, id: b.connect({ x: 0, y }, { x: 200, y }, { arrow: false }), y };
      }),
    );
    const doc = b.build();
    const records = { ...doc.records };
    for (const c of cases) records[c.id] = { ...(records[c.id] as object), markers: { end: c.def.id }, style: { stroke: { width: c.width } } } as never;
    const file = join(dir, 'markers.flux.json');
    writeFileSync(file, JSON.stringify({ ...doc, records } as DocumentFile));
    const out = join(dir, 'markers.html');
    // the built bin, as users run it (the e2e suites never run the sources)
    const r = fluxion(['render', file, '-o', out]);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(out, 'utf8');
    for (const c of cases) {
      // the connector's own markup: from its element to the next
      const at = html.indexOf(`data-el-id="${c.id as RecordId}"`);
      const own = html.slice(at, html.indexOf('data-el-id=', at + 1) === -1 ? undefined : html.indexOf('data-el-id=', at + 1));
      const trim = markerTrim(c.def, c.width);
      // sized in stroke widths, its reference point `inset` back from the tip, drawn as a stroke as wide as the line
      expect(own, c.def.id).toMatch(
        new RegExp(
          `<marker id="fx-marker-[\\w-]+-end" viewBox="0 0 10 10" refX="${10 - c.def.inset}" refY="5" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" markerUnits="strokeWidth"[^>]*><path d="${literal(c.def.path)}" style="fill:none;stroke:[^;]+;stroke-width:${10 / MARKER_SIZE};stroke-linejoin:bevel;stroke-linecap:butt"`,
        ),
      );
      // the line stops under the marker by its inset, which scales with the stroke width
      expect(own, `${c.def.id} at ${c.width}`).toContain(`d="M0 ${c.y} L${200 - trim} ${c.y}"`);
    }
    // the ringed markers stop the line at the ring's back: twice as far at twice the width
    const ringed = cases.filter((c) => c.def.inset > 0);
    expect(ringed.map((c) => markerTrim(c.def, c.width))).toEqual([10, 20, 10, 20]);
  });
});
