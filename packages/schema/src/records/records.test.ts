import { describe, expect, it } from 'vitest';
import { commentRecordSchema, interactionRecordSchema, stepRecordSchema, timelineRecordSchema, variableRecordSchema } from './behaviour.js';
import { assetRecordSchema, pluginRefRecordSchema, themeRecordSchema } from './resources.js';

const hash = 'a'.repeat(64);

describe('resource and behaviour records', () => {
  it('FR-DOC-001: asset, theme and plugin-ref records validate', () => {
    expect(assetRecordSchema.safeParse({ id: 'a1', type: 'asset', hash, mime: 'image/png', size: 1024, name: 'logo.png', w: 64, h: 64 }).success).toBe(true);
    expect(
      assetRecordSchema.safeParse({ id: 'a2', type: 'asset', hash, mime: 'font/woff2', size: 0, name: 'x', source: 'https://cdn.example.com/x.woff2' }).success,
    ).toBe(true);
    expect(
      themeRecordSchema.safeParse({ id: 'th1', type: 'theme', name: 'Default', tokens: { color: { primary: { $value: '#3355ff', $type: 'color' } } } }).success,
    ).toBe(true);
    expect(
      pluginRefRecordSchema.safeParse({ id: 'p1', type: 'plugin-ref', pluginId: 'acme', version: '1.2.3', integrity: 'sha384-abc+/=', trust: 'sandboxed' })
        .success,
    ).toBe(true);
  });

  it('rejects malformed resources', () => {
    const asset = { id: 'a1', type: 'asset', hash, mime: 'image/png', size: 1, name: 'x' };
    for (const bad of [
      { ...asset, hash: 'abc' },
      { ...asset, hash: 'A'.repeat(64) },
      { ...asset, mime: 'png' },
      { ...asset, size: -1 },
      { ...asset, size: 1.5 },
      { ...asset, source: 'javascript:alert(1)' },
      { ...asset, source: 'file:///etc/passwd' },
    ])
      expect(assetRecordSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const ref = { id: 'p1', type: 'plugin-ref', pluginId: 'acme', version: '1.2.3', trust: 'trusted' };
    for (const bad of [
      { ...ref, version: '^1.2' },
      { ...ref, pluginId: 'Acme Co' },
      { ...ref, trust: 'root' },
      { ...ref, integrity: 'md5-x' },
    ])
      expect(pluginRefRecordSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(themeRecordSchema.safeParse({ id: 'th', type: 'theme', name: 'x' }).success).toBe(false);
  });

  it('FR-DOC-001: timeline, step, interaction, variable and comment records validate', () => {
    expect(timelineRecordSchema.safeParse({ id: 't1', type: 'timeline', screenId: 's1', name: 'main', index: 'a0' }).success).toBe(true);
    const step = {
      id: 'st1',
      type: 'step',
      timelineId: 't1',
      index: 'a0',
      trigger: { kind: 'onClick' },
      animations: [{ id: 'an1', effect: 'fade-in', targets: ['e1'] }],
    };
    expect(stepRecordSchema.parse(step)).toEqual(step);
    const interaction = {
      id: 'i1',
      type: 'interaction',
      ownerId: 'e1',
      trigger: { kind: 'onClick' },
      condition: 'count > 1',
      actions: [{ kind: 'goToScreen', screenId: 's2' }],
    };
    expect(interactionRecordSchema.parse(interaction)).toEqual(interaction);
    expect(variableRecordSchema.safeParse({ id: 'v1', type: 'variable', name: 'count', valueType: 'number', default: 0 }).success).toBe(true);
    const comment = { id: 'cm1', type: 'comment', targetId: 'e1', author: 'Ada', body: 'Check this' };
    expect(commentRecordSchema.parse(comment)).toEqual(comment);
  });

  it('rejects malformed behaviour records', () => {
    expect(stepRecordSchema.safeParse({ id: 'st', type: 'step', timelineId: 't1', index: 'a0', trigger: {}, animations: [] }).success).toBe(false);
    expect(stepRecordSchema.safeParse({ id: 'st', type: 'step', timelineId: 't1', index: 'a0', trigger: { kind: 'onClick' }, animations: [{}] }).success).toBe(
      false,
    );
    expect(interactionRecordSchema.safeParse({ id: 'i', type: 'interaction', ownerId: 'e1', trigger: { kind: 'onClick' } }).success).toBe(false);
    expect(variableRecordSchema.safeParse({ id: 'v', type: 'variable', name: '1st', valueType: 'number' }).success).toBe(false);
    expect(variableRecordSchema.safeParse({ id: 'v', type: 'variable', name: 'x', valueType: 'date' }).success).toBe(false);
    expect(timelineRecordSchema.safeParse({ id: 't', type: 'timeline', screenId: 's1', name: '', index: 'a0' }).success).toBe(false);
    expect(commentRecordSchema.safeParse({ id: 'c', type: 'comment', targetId: 'e1', author: 'A', body: 'x', created: 'now' }).success).toBe(false);
  });
});
