import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { renderScreenPng } from './screen-png.js';

describe('the screen photograph (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: with no screen named, the first visible screen that is not a master is drawn, though the master sorts first', async () => {
    const b = documentBuilder({ seed: 4922 });
    const master = b.screen({ name: 'brand' });
    const slide = b.screen({ name: 'slide' });
    const built = b.build();
    const records = {
      ...built.records,
      [master]: { ...(built.records[master] as object), role: 'master' },
      [slide]: { ...(built.records[slide] as object), masterId: master },
    };
    const text = serializeDocument({ ...built, records } as DocumentFile);
    const launched: string[] = [];
    // no browser here: reaching the launch means a screen was chosen and drawn on the page
    const result = await renderScreenPng(text, {
      launch: () => {
        launched.push('launch');
        return Promise.reject(new Error('no browser'));
      },
    });
    expect(launched).toEqual(['launch']);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).not.toContain('FLX_CLI_USAGE');
  });
});
