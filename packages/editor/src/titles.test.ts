import { readFileSync } from 'node:fs';
import { createRegistry } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { EDITOR_COMMANDS } from './editor-commands.js';
import { COMMAND_MESSAGES, commandTitle, TOOL_MESSAGES, toolTitle } from './titles.js';
import type { Tool } from './tools.js';

const catalog = JSON.parse(readFileSync(new URL('./locales/en/messages.json', import.meta.url), 'utf8')) as Record<string, { message: string }>;
// the tools registerBuiltinTools registers, read from the registry itself: a built-in tool added there is in this list
const registry = createRegistry<string, Tool>('tools');
registerBuiltinTools(registry);
const TOOLS = registry.list().map(([, tool]) => tool);

describe('command and tool titles by id (NFR-I18N-001, ADR-0023)', () => {
  it('NFR-I18N-001: every editor command has a command.<id> message in the catalog, with its own title as the English text', () => {
    for (const c of EDITOR_COMMANDS) {
      expect(COMMAND_MESSAGES[c.id]?.message, c.id).toBe(c.title);
      expect(catalog[`command.${c.id}`]?.message, c.id).toBe(c.title);
      expect(commandTitle(c)).toBe(c.title);
    }
    // and no message is left over for a command that is gone
    const ids = new Set(EDITOR_COMMANDS.map((c) => `command.${c.id}`));
    for (const id of Object.keys(catalog).filter((k) => k.startsWith('command.'))) expect(ids.has(id), id).toBe(true);
  });

  it('NFR-I18N-001: every built-in tool has a tool.<id> message in the catalog, with its own title as the English text', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(10);
    for (const t of TOOLS) {
      expect(TOOL_MESSAGES[t.id]?.message, t.id).toBe(t.title);
      expect(catalog[`tool.${t.id}`]?.message, t.id).toBe(t.title);
      expect(toolTitle(t)).toBe(t.title);
    }
    const ids = new Set(TOOLS.map((t) => `tool.${t.id}`));
    for (const id of Object.keys(catalog).filter((k) => k.startsWith('tool.'))) expect(ids.has(id), id).toBe(true);
  });

  it("NFR-I18N-001: a command or tool without a message (a plugin's) shows its own title", () => {
    expect(commandTitle({ id: 'plugin.x', title: 'Do X' })).toBe('Do X');
    expect(toolTitle({ id: 'plugin.tool', title: 'My tool' })).toBe('My tool');
  });
});
