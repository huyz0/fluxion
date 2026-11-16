// NFR-PORT-001: boot phases are marked on the performance timeline once per page (M19.29).
import { describe, expect, it } from 'vitest';
import { bootMark, bootMarkName } from './boot-phase.js';

describe('boot phases (M19.29)', () => {
  it('NFR-PORT-001: a phase is marked once under fluxion:boot:<phase>, a remount marking nothing more; no timeline marks nothing', () => {
    const marks: string[] = [];
    const timeline = {
      mark: (name: string) => {
        marks.push(name);
        return undefined as unknown as PerformanceMark;
      },
      getEntriesByName: (name: string) => marks.filter((m) => m === name).map((m) => ({ name: m }) as PerformanceEntry),
    };
    bootMark('lock', timeline);
    bootMark('lock', timeline);
    bootMark('editor', timeline);
    expect(marks).toEqual([bootMarkName('lock'), 'fluxion:boot:editor']);
    expect(() => bootMark('start', undefined)).not.toThrow();
  });
});
