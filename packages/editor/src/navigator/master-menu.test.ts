import type { RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { MASTER_PREFIX, masterCommand, masterLines } from './master-menu.js';
import type { Row } from './navigator-model.js';

const row = (id: string, fields: Partial<Row> = {}): Row => ({
  id: id as RecordId,
  label: id,
  hidden: false,
  format: '16:9',
  size: { w: 1920, h: 1080 },
  ...fields,
});
const masters = [row('M1', { master: true, label: 'Brand' }), row('M2', { master: true, label: 'Dark' })];

describe('navigator master lines (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: a screen with no master can become one or use each master; with one it can use another or none', () => {
    expect(masterLines(row('S'), masters).map((l) => l.title)).toEqual(['Make master', 'Use master: Brand', 'Use master: Dark']);
    expect(masterLines(row('S', { masterId: 'M1' as RecordId }), masters).map((l) => l.title)).toEqual(['Use master: Dark', 'No master']);
  });

  it('FR-SCR-005: a master can become an ordinary screen; an infinite screen has no master lines', () => {
    expect(masterLines(masters[0], masters).map((l) => l.title)).toEqual(['Make ordinary screen']);
    expect(masterLines(row('I', { format: 'Infinite' }), masters)).toEqual([]);
    expect(masterLines(undefined, masters)).toEqual([]);
  });

  it('FR-SCR-005: each line runs one master command on the screen', () => {
    const s = 'S' as RecordId;
    expect(masterCommand(`${MASTER_PREFIX}make`, s)).toEqual({ id: 'screen.setRole', args: { id: s, master: true } });
    expect(masterCommand(`${MASTER_PREFIX}ordinary`, s)).toEqual({ id: 'screen.setRole', args: { id: s, master: false } });
    expect(masterCommand(`${MASTER_PREFIX}use:M2`, s)).toEqual({ id: 'screen.setMaster', args: { id: s, masterId: 'M2' } });
    expect(masterCommand(`${MASTER_PREFIX}none`, s)).toEqual({ id: 'screen.setMaster', args: { id: s } });
    expect(masterCommand('screen.delete', s)).toBeUndefined();
    expect(masterCommand(`${MASTER_PREFIX}other`, s)).toBeUndefined();
  });
});
