import { compareKeys, type DocumentFile, type RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';
import { keysAfter, siblings } from './siblings.js';

describe('sibling ordering (FR-ARR-001, FR-ARR-004)', () => {
  it('FR-ARR-001: root siblings exclude grouped children and other screens', () => {
    const builder = documentBuilder({ seed: 54 });
    const screen = builder.screen();
    const first = builder.rect(screen);
    const second = builder.rect(screen);
    const last = builder.rect(screen);
    const otherScreen = builder.screen();
    const other = builder.rect(otherScreen);
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(builder.build(), { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const group = 'group' as RecordId;
    expect(executeCommand(commands, { store }, 'element.group', { ids: [first, second], groupId: group }).ok).toBe(true);
    expect(siblings({ store }, screen, undefined).map((el) => el.id)).toEqual([group, last]);
    expect(siblings({ store }, screen, group).map((el) => el.id)).toEqual([first, second]);
    expect(siblings({ store }, otherScreen, undefined).map((el) => el.id)).toEqual([other]);
  });

  it('FR-ARR-004: a loaded element without an index does not enter an ordered sibling list', () => {
    const builder = documentBuilder({ seed: 55 });
    const screen = builder.screen();
    const first = builder.rect(screen);
    const malformed = builder.rect(screen);
    const last = builder.rect(screen);
    // The store accepts initial records without revalidating them; transactions still validate.
    // Exercise its defensive ordering of an already loaded malformed element, without disabling validation.
    const file = builder.build();
    const record = { ...file.records[malformed] } as { index?: string };
    delete record.index;
    const store = new RecordStore({ ...file, records: { ...file.records, [malformed]: record } } as DocumentFile);
    expect(store.members('byScreen', screen)).toContain(malformed);
    expect(siblings({ store }, screen, undefined).map((el) => el.id)).toEqual([first, last]);
  });

  it('FR-ARR-004: inserts exactly the requested number of keys between adjacent neighbours', () => {
    for (const count of [0, 1, 2, 7]) {
      const result = keysAfter('a0', ['Zz', 'a0', 'a1', 'a2'], count);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(count);
      expect(new Set(result.value).size).toBe(count);
      const bounds = ['a0', ...result.value, 'a1'];
      for (let i = 1; i < bounds.length; i++) expect(compareKeys(bounds[i - 1] as string, bounds[i] as string)).toBeLessThan(0);
    }
    expect(keysAfter('a0', ['a0'], 0)).toEqual({ ok: true, value: [] });
  });
});
