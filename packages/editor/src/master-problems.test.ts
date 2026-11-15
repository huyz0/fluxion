import { createCore } from '@fluxion/core';
import type { DocumentFile } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { masterProblems } from './master-problems.js';
import { problemsOf } from './problems.js';

/** A master with two placeholders named `title`; a screen filling a non-placeholder; screens whose master does not apply. */
function setup() {
  const b = documentBuilder({ seed: 3922 });
  const master = b.screen({ name: 'Brand' });
  const logo = b.rect(master, { x: 0, y: 0, w: 10, h: 10 });
  const one = b.rect(master, { x: 0, y: 20, w: 10, h: 10 });
  const two = b.rect(master, { x: 0, y: 40, w: 10, h: 10 });
  const plain = b.screen();
  const stray = b.rect(plain, { x: 0, y: 0, w: 10, h: 10 });
  const ordinary = b.screen({ name: 'Plain' });
  const toOrdinary = b.screen();
  const small = b.screen({ size: { w: 100, h: 100 } });
  const file = b.build();
  const fields: Record<string, object> = {
    [master]: { role: 'master' },
    [one]: { placeholder: 'title' },
    [two]: { placeholder: 'title' },
    [plain]: { masterId: master },
    [stray]: { fills: logo },
    [toOrdinary]: { masterId: ordinary },
    [small]: { masterId: master },
  };
  const records = Object.fromEntries(Object.entries(file.records).map(([id, r]) => [id, { ...r, ...fields[id] }]));
  const doc = { ...file, records } as unknown as DocumentFile;
  return { doc, core: createCore(doc), master, one, two, plain, stray, toOrdinary, small };
}

describe('master problems (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: the Problems tab says why a master does not apply, which fills is stray (with a fix), and which placeholder names are shared', () => {
    const t = setup();
    const problems = masterProblems(t.core.store);
    const byId = new Map(problems.map((p) => [p.id.split('|')[0], p]));
    expect(byId.get('FLX_MASTER_NOT_MASTER')?.id).toBe(`FLX_MASTER_NOT_MASTER|${t.toOrdinary}`);
    expect(byId.get('FLX_MASTER_SIZE')?.message).toContain('size differs');
    const stray = byId.get('FLX_FILLS_NO_PLACEHOLDER');
    expect(stray?.elements).toEqual([t.stray]);
    expect(stray?.fix).toEqual({ title: 'Stop filling the placeholder', command: 'element.update', args: { id: t.stray, fields: { fills: undefined } } });
    expect(byId.get('FLX_PLACEHOLDER_SHARED')).toMatchObject({ severity: 'info', elements: [t.one, t.two].sort() });
    expect(problems).toHaveLength(4);
    // the fix drops the stray fill, and the problem with it
    expect(t.core.execute('element.update', stray?.fix?.args as never).ok).toBe(true);
    expect(masterProblems(t.core.store).map((p) => p.id.split('|')[0])).not.toContain('FLX_FILLS_NO_PLACEHOLDER');
    // the panel's list carries them
    expect(
      problemsOf(t.doc).filter((p) => p.id.startsWith('FLX_MASTER_') || p.id.startsWith('FLX_FILLS_') || p.id.startsWith('FLX_PLACEHOLDER_')),
    ).toHaveLength(4);
  });
});
