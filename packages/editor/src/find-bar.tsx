// The find bar (FR-EDT-016): Ctrl/Cmd+F opens it over the canvas. Typing highlights every element the query finds on the
// shown screen (find-marks.tsx); Enter (or Next) jumps to the next match, Shift+Enter (or Previous) to the previous one,
// crossing screens, and selects it; Esc (or Close) closes it and clears the highlights. A search landmark; its count is a
// live status.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { findMatches, keyIds, matchKey, stepMatch } from './find-model.js';
import { shownScreen, switchScreen } from './screen-switch.js';
import type { Session } from './session.js';
import type { ToolCtx } from './tools.js';

/** Props of {@link FindBar}. */
export type FindBarProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose find state, screen and selection it drives. */
  readonly session: Session;
};

/**
 * Show the match `step` (1 next, -1 previous) from the current one: its screen, and it selected. False when the query finds
 * nothing (or the bar is closed).
 *
 * @public
 */
export function jumpToMatch(store: Store, session: Session, step: 1 | -1): boolean {
  const find = session.find.get();
  if (find === undefined) return false;
  const { matches, shown } = store.query((view) => ({ matches: findMatches(view, find.query), shown: shownScreen(view, session.screen.get()) }))();
  const next = stepMatch(matches, find.current, step, shown);
  if (next === undefined) return false;
  if (next.screen !== shown) switchScreen(session, next.screen);
  session.selection.set([next.id]);
  session.find.set({ ...find, current: next.id });
  return true;
}

/** Open the find bar, or focus it again when it is open (its query kept). */
export function openFind(ctx: ToolCtx): boolean {
  const find = ctx.session.find.get();
  ctx.session.find.set({ query: find?.query ?? '', current: find?.current, opened: (find?.opened ?? 0) + 1 });
  return true;
}

/** The find bar's editor command: its id, title and action (Ctrl/Cmd+F). */
export const FIND_ACTIONS: readonly (readonly [id: string, title: string, act: (ctx: ToolCtx) => boolean])[] = [['find.open', 'Find elements', openFind]];

/** What a key does in the bar: undefined when it types (Enter jumps only from the input, not from a button). */
function barKey(e: KeyboardEvent<HTMLElement>, inInput: boolean): 'close' | 'select' | 'next' | 'previous' | undefined {
  if (e.key === 'Escape') return 'close';
  if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) return 'select';
  if (e.key !== 'Enter' || !inInput) return undefined;
  return e.shiftKey ? 'previous' : 'next';
}

/** What the count reads: nothing for a blank query. */
function countText(query: string, found: number, at: number): string {
  if (query.trim() === '') return '';
  if (found === 0) return t`No matches`;
  return at < 0 ? t`${found} matches` : t`${at + 1} of ${found}`;
}

/** The find bar, while `session.find` is set. */
export function FindBar(props: FindBarProps): ReactNode {
  const { store, session } = props;
  const find = useValue(session.find.get);
  const mode = useValue(session.mode.get);
  const input = useRef<HTMLInputElement>(null);
  const query = find?.query ?? '';
  // a key, so the count re-renders only when the matches change, not with every edit (docs/standards/performance.md)
  const found = useValue(useMemo(() => store.query((view) => matchKey(view, query)), [store, query]));
  const matches = useMemo(() => keyIds(found), [found]);
  // each Ctrl/Cmd+F focuses it again, open already or not
  const opened = find?.opened;
  useEffect(() => {
    if (opened !== undefined) input.current?.select();
  }, [opened]);
  if (find === undefined || mode !== 'edit') return null;
  const close = () => session.find.set(undefined);
  const doing = {
    close,
    // Ctrl/Cmd+F in the bar selects its query again rather than opening the browser's find
    select: () => input.current?.select(),
    next: () => jumpToMatch(store, session, 1),
    previous: () => jumpToMatch(store, session, -1),
  };
  const key = (e: KeyboardEvent<HTMLElement>) => {
    // the canvas's shortcuts do not act behind the bar
    e.stopPropagation();
    const act = barKey(e, e.target === input.current);
    if (act === undefined) return;
    e.preventDefault();
    doing[act]();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: <search> has no implicit role in every engine the editor supports yet
    <div role="search" className="fx-chrome-find" aria-label={t`Find elements`} onKeyDown={key}>
      <input
        ref={input}
        className="fx-chrome-input"
        type="search"
        aria-label={t`Find by text or label`}
        placeholder={t`Find by text or label`}
        value={query}
        onChange={(e) => session.find.set({ ...find, query: e.target.value, current: undefined })}
      />
      <output className="fx-chrome-find-count" aria-live="polite">
        {countText(query, matches.length, matches.indexOf(find.current as RecordId))}
      </output>
      <button type="button" className="fx-chrome-button" disabled={matches.length === 0} onClick={() => jumpToMatch(store, session, -1)}>
        {t`Previous`}
      </button>
      <button type="button" className="fx-chrome-button" disabled={matches.length === 0} onClick={() => jumpToMatch(store, session, 1)}>
        {t`Next`}
      </button>
      <button type="button" className="fx-chrome-button" onClick={close}>
        {t`Close`}
      </button>
    </div>
  );
}
