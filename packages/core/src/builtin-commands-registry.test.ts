import { describe, expect, it } from 'vitest';
import { CORE_COMMANDS, registerCoreCommands } from './builtin-commands.js';
import type { AnyCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';

describe('built-in record commands (FR-EXT-001)', () => {
  it('FR-EXT-001: the built-ins are registered through the registry as source core', () => {
    const commands = createRegistry<string, AnyCommand>('commands');
    expect(registerCoreCommands(commands)).toEqual([]);
    expect(commands.list().map(([id]) => id)).toEqual([
      'asset.create',
      'binding.set',
      'connector.freeEnd',
      'document.setTheme',
      'document.update',
      'document.updateMeta',
      'element.align',
      'element.create',
      'element.createMany',
      'element.delete',
      'element.distribute',
      'element.group',
      'element.ungroup',
      'element.update',
      'element.updateMany',
      'element.zOrder',
      'screen.create',
      'screen.delete',
      'screen.duplicate',
      'screen.move',
      'screen.rename',
      'screen.reorder',
      'screen.setFormat',
      'screen.setHidden',
      'screen.setNotes',
      'screen.setSection',
      'screen.setThemeOverride',
      'section.create',
      'section.delete',
      'section.rename',
      'section.reorder',
      'section.setCollapsed',
    ]);
    expect(CORE_COMMANDS.every((c) => commands.source(c.id) === 'core')).toBe(true);
    // a plugin holding a built-in id is reported, not silently skipped (M3.14 review F1)
    const taken = createRegistry<string, AnyCommand>('commands');
    taken.register('element.update', CORE_COMMANDS[0] as AnyCommand, 'acme');
    expect(registerCoreCommands(taken).map((d) => d.code)).toEqual(['FLX_REGISTRY_DUPLICATE']);
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    hooks.register('core:1-screens', () => {}, 'acme');
    expect(registerCoreHooks(hooks).map((d) => d.code)).toEqual(['FLX_REGISTRY_DUPLICATE']);
  });
});
