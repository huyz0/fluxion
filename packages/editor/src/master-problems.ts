// A document's master problems (FR-SCR-005, ADR-0054): master rules are drawing rules, not file validity, so a file can name a
// master that does not apply, fill no placeholder, or give two placeholders one name, and still open. The Problems tab says why a
// screen draws without its master, which `fills` draws as an ordinary element (with a fix that drops it), and which names a master
// shares.
import { appliedMaster, isMasterScreen, type MasterProblemCode, type ReadView, sharedPlaceholderNames, strayFills } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import type { Problem } from './problem-types.js';

/** Why a screen's master does not apply, for people. */
const WHY: { readonly [C in MasterProblemCode]: string } = {
  'not-master': 'it names a screen that is not a master',
  chain: 'its master names a master of its own, and masters apply one level only',
  infinite: 'an infinite screen has no frame to draw a master behind',
  size: 'its size differs from its master’s',
};

type Named = { readonly name?: unknown; readonly role?: unknown };

const nameOf = (view: ReadView, id: RecordId): string => {
  const name = (view.get(id) as Named | undefined)?.name;
  return typeof name === 'string' && name.trim() !== '' ? `"${name}"` : id;
};

/** The problem of a screen whose `masterId` does not apply. */
function unapplied(view: ReadView, screen: RecordId): Problem[] {
  const { problem } = appliedMaster(view, screen);
  if (problem === undefined) return [];
  return [
    {
      id: `FLX_MASTER_${problem.toUpperCase().replace('-', '_')}|${screen}`,
      severity: 'warning',
      message: `Screen ${nameOf(view, screen)} draws without its master: ${WHY[problem]}.`,
      elements: [],
    },
  ];
}

/** One problem for each element of `screen` whose `fills` names no placeholder of its applied master. */
function stray(view: ReadView, screen: RecordId): Problem[] {
  return strayFills(view, screen).map(
    (id): Problem => ({
      id: `FLX_FILLS_NO_PLACEHOLDER|${id}`,
      severity: 'warning',
      message: 'This element fills no placeholder of its screen’s master: it draws as an ordinary element.',
      elements: [id],
      fix: { title: 'Stop filling the placeholder', command: 'element.update', args: { id, fields: { fills: undefined } } },
    }),
  );
}

/** One problem for each name two or more placeholders of the master `master` share. */
function shared(view: ReadView, master: RecordId): Problem[] {
  return [...sharedPlaceholderNames(view, master)].map(
    ([name, ids]): Problem => ({
      id: `FLX_PLACEHOLDER_SHARED|${master}|${name}`,
      severity: 'info',
      message: `${ids.length} placeholders of master ${nameOf(view, master)} are named "${name}"; each is still filled by its own id.`,
      elements: ids,
    }),
  );
}

/**
 * The master problems of every screen `view` holds, by screen id: a master that does not apply (and why), an element filling no
 * placeholder of its master, and placeholders of one master sharing a name.
 *
 * @public
 */
export function masterProblems(view: ReadView): Problem[] {
  return [...view.members('byType', 'screen')]
    .sort()
    .flatMap((screen) => [...unapplied(view, screen), ...stray(view, screen), ...(isMasterScreen(view.get(screen) as never) ? shared(view, screen) : [])]);
}
