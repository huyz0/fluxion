// The navigator's master lines (FR-SCR-005, ADR-0054): a screen's menu makes it a master, gives it a master or takes its master
// away; a master's menu makes it an ordinary screen again. Each line is one master command, so one undo step.
import type { RecordId } from '@fluxion/schema';
import type { Row } from './navigator-model.js';

/** The menu command of a master line: `make`, `ordinary`, `none`, or `use:<master id>`. */
export const MASTER_PREFIX = 'screen.master:';

type Line = { readonly command: string; readonly title: string };

/**
 * The master lines of `row`'s menu, given the document's `masters`: a master becomes ordinary; an infinite screen has none (no
 * frame to draw a master behind); a screen with no master can become one; any other screen can use each master it does not
 * use, or no master.
 */
export function masterLines(row: Row | undefined, masters: readonly Row[]): readonly Line[] {
  if (row === undefined) return [];
  if (row.master === true) return [{ command: `${MASTER_PREFIX}ordinary`, title: 'Make ordinary screen' }];
  if (row.format === 'Infinite') return [];
  const uses = masters.filter((m) => m.id !== row.masterId).map((m) => ({ command: `${MASTER_PREFIX}use:${m.id}`, title: `Use master: ${m.label}` }));
  return [
    ...(row.masterId === undefined ? [{ command: `${MASTER_PREFIX}make`, title: 'Make master' }] : []),
    ...uses,
    ...(row.masterId === undefined ? [] : [{ command: `${MASTER_PREFIX}none`, title: 'No master' }]),
  ];
}

/** The command and arguments a master line runs on `target`, or undefined for a line that is not one. */
export function masterCommand(command: string, target: RecordId): { readonly id: string; readonly args: object } | undefined {
  if (!command.startsWith(MASTER_PREFIX)) return undefined;
  const what = command.slice(MASTER_PREFIX.length);
  if (what === 'make' || what === 'ordinary') return { id: 'screen.setRole', args: { id: target, master: what === 'make' } };
  if (what === 'none') return { id: 'screen.setMaster', args: { id: target } };
  return what.startsWith('use:') ? { id: 'screen.setMaster', args: { id: target, masterId: what.slice('use:'.length) } } : undefined;
}
