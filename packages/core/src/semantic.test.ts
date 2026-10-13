// FR-DOC-007: an element's `semantic` data (slug, label, role, tags and any further data keys) is independent of its visual style:
// a style change through the built-in commands leaves it byte-equal.
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

const SEMANTIC = { slug: 'api', label: 'API gateway', role: 'service', tags: ['edge', 'public'], owner: 'platform', data: { tier: 1, regions: ['eu', 'us'] } };

function setup() {
  const b = documentBuilder({ seed: 41 });
  const screen = b.screen();
  const ids = [b.rect(screen), b.rect(screen, { x: 300 }), b.rect(screen, { x: 600 })];
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const semantic = (id: RecordId) => JSON.stringify((store.get(id) as { semantic?: unknown }).semantic);
  return { run, semantic, ids };
}

const STYLES = [{ variant: 'emphasis' }, { fill: '#ff0000', opacity: 0.8 }, { opacity: 0.4 }, {}];

describe('semantic data (FR-DOC-007)', () => {
  it('FR-DOC-007: element.update of style leaves semantic byte-equal, extra data keys included', () => {
    const { run, semantic, ids } = setup();
    const [id] = ids as [RecordId, ...RecordId[]];
    expect(run('element.update', { id, fields: { semantic: SEMANTIC } }).ok).toBe(true);
    const before = semantic(id);
    expect(before).toBe(JSON.stringify(SEMANTIC));
    for (const style of STYLES) {
      expect(run('element.update', { id, fields: { style } })).toMatchObject({ ok: true });
      expect(semantic(id)).toBe(before);
    }
  });

  it('FR-DOC-007: element.updateMany of style leaves the semantic of every target byte-equal', () => {
    const { run, semantic, ids } = setup();
    for (const [i, id] of ids.entries()) run('element.update', { id, fields: { semantic: { ...SEMANTIC, slug: `n${i}` } } });
    const before = ids.map(semantic);
    for (const style of STYLES) {
      expect(run('element.updateMany', { updates: ids.map((id) => ({ id, fields: { style } })) }).ok).toBe(true);
      expect(ids.map(semantic)).toEqual(before);
    }
  });
});
