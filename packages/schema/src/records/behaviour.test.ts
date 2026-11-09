// FR-DOC-001: each behaviour record's fields are checked directly, so a dropped literal, bound,
// keyword or regex anchor changes a verdict here.
import { describe, expect, it } from 'vitest';
import { commentRecordSchema, interactionRecordSchema, stepRecordSchema, timelineRecordSchema, variableRecordSchema } from './behaviour.js';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;
const timeline = { id: 't1', type: 'timeline', screenId: 's1', name: 'Main', index: 'a0' };
const step = { id: 'st1', type: 'step', timelineId: 't1', index: 'a0', trigger: { kind: 'click' }, animations: [] };
const interaction = { id: 'i1', type: 'interaction', ownerId: 'e1', trigger: { kind: 'click' }, actions: [] };
const variable = { id: 'v1', type: 'variable', name: 'count', valueType: 'number' };
const comment = { id: 'c1', type: 'comment', targetId: 'e1', author: 'A', body: 'B' };
const ALL = [
  [timelineRecordSchema, timeline],
  [stepRecordSchema, step],
  [interactionRecordSchema, interaction],
  [variableRecordSchema, variable],
  [commentRecordSchema, comment],
] as const;

describe('behaviour records, field by field', () => {
  it('FR-DOC-001: each record validates with its own type and keeps unknown fields', () => {
    for (const [schema, value] of ALL) {
      expect(schema.parse({ ...value, extra: 1 }), value.type).toEqual({ ...value, extra: 1 });
      expect(ok(schema, { ...value, type: 'other' }), value.type).toBe(false);
      expect(ok(schema, { ...value, id: undefined }), value.type).toBe(false);
      expect(ok(schema, { ...value, meta: { a: 1 } }), value.type).toBe(true);
    }
  });

  it('FR-DOC-001: a timeline has a screen, a non-empty name, an index and an optional loop', () => {
    expect(ok(timelineRecordSchema, { ...timeline, name: 'x', loop: true })).toBe(true);
    for (const bad of [{ name: '' }, { loop: 'yes' }, { screenId: undefined }, { index: undefined }])
      expect(ok(timelineRecordSchema, { ...timeline, ...bad }), JSON.stringify(bad)).toBe(false);
  });

  it('FR-DOC-001: a step has a tagged trigger and animations with non-empty ids', () => {
    expect(ok(stepRecordSchema, { ...step, trigger: { kind: 'x', extra: 1 }, animations: [{ id: 'a' }, { id: 'b', extra: 1 }], label: 'L' })).toBe(true);
    for (const bad of [
      { trigger: { kind: '' } },
      { trigger: {} },
      { animations: [{ id: '' }] },
      { animations: [{}] },
      { label: 1 },
      { timelineId: undefined },
      { animations: undefined },
    ])
      expect(ok(stepRecordSchema, { ...step, ...bad }), JSON.stringify(bad)).toBe(false);
  });

  it('FR-DOC-001: an interaction has a tagged trigger, tagged actions and an optional condition', () => {
    expect(ok(interactionRecordSchema, { ...interaction, actions: [{ kind: 'goto' }, { kind: 'step' }], condition: 'x > 1' })).toBe(true);
    for (const bad of [{ actions: [{ kind: '' }] }, { trigger: { kind: '' } }, { condition: 1 }, { ownerId: undefined }])
      expect(ok(interactionRecordSchema, { ...interaction, ...bad }), JSON.stringify(bad)).toBe(false);
  });

  it('FR-DOC-001: a variable name is an identifier, with its own message, and its type is one of five', () => {
    for (const name of ['a', '_', 'A_1', 'count2', 'abc']) expect(ok(variableRecordSchema, { ...variable, name }), name).toBe(true);
    for (const name of ['1a', 'a-b', 'a b', '', 'é', 'xa!', '!a']) expect(ok(variableRecordSchema, { ...variable, name }), name).toBe(false);
    expect(variableRecordSchema.safeParse({ ...variable, name: '1a' }).error?.issues.map((i) => i.message)).toEqual(['expected an identifier']);
    for (const valueType of ['string', 'number', 'boolean', 'color', 'json'])
      expect(ok(variableRecordSchema, { ...variable, valueType }), valueType).toBe(true);
    for (const valueType of ['', 'date']) expect(ok(variableRecordSchema, { ...variable, valueType }), valueType).toBe(false);
    expect(ok(variableRecordSchema, { ...variable, default: { any: [1] } })).toBe(true);
  });

  it('FR-DOC-001: a comment has an author and body, and an optional resolved flag and ISO time with offset', () => {
    expect(ok(commentRecordSchema, { ...comment, resolved: false, created: '2026-01-02T03:04:05Z' })).toBe(true);
    expect(ok(commentRecordSchema, { ...comment, created: '2026-01-02T03:04:05+02:00' })).toBe(true);
    for (const bad of [{ resolved: 'no' }, { created: '2026-01-02' }, { created: 'yesterday' }, { author: 1 }, { body: undefined }, { targetId: undefined }])
      expect(ok(commentRecordSchema, { ...comment, ...bad }), JSON.stringify(bad)).toBe(false);
  });
});
