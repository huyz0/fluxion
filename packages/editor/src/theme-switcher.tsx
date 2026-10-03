// The theme switcher of the toolbar (FR-THM-004, M9.10): the document's theme and the open screen's own, each a choice among
// the themes the host offers (the packs' themes registry). Choosing runs `document.setTheme` or `screen.setThemeOverride`: one
// undo step, the chosen theme copied into the document.

import type { Store } from '@fluxion/core';
import { themeRecordId } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import type { Execute } from './pointer.js';

/**
 * A theme the host offers: a name and its token tree (a pack's `ThemeDef` fits).
 *
 * @public
 */
export type ThemeChoice = {
  /** The theme's name; the document's copy is `theme-<slug of name>`. */
  readonly name: string;
  /** The DTCG token tree. */
  readonly tokens: { readonly [key: string]: unknown };
  /** Default styles by element kind. */
  readonly defaults?: { readonly [key: string]: unknown };
};

/**
 * Props of {@link ThemeSwitcher}.
 *
 * @public
 */
export type ThemeSwitcherProps = {
  /** The document store (the themes in use are read from it). */
  readonly store: Store;
  /** Runs the theme commands. */
  readonly execute: Execute;
  /** The themes on offer. */
  readonly themes: readonly ThemeChoice[];
  /** The open screen, whose override the second control sets. */
  readonly screenId: RecordId | undefined;
};

const body = (t: ThemeChoice) => ({ name: t.name, tokens: t.tokens, ...(t.defaults === undefined ? {} : { defaults: t.defaults }) });

/** The idle value of a control: the id of the theme record in use (empty for none). */
function idOf(rec: unknown): string {
  const id = (rec as { themeId?: unknown } | undefined)?.themeId;
  return typeof id === 'string' ? id : '';
}

/** One select over `themes`; `none` is the label of the empty choice (absent: the document has to have a theme). */
function ThemeSelect(props: {
  readonly label: string;
  readonly value: string;
  readonly themes: readonly ThemeChoice[];
  readonly none: string;
  /** Whether choosing the empty option does something (a document always keeps a theme once it has one). */
  readonly clearable: boolean;
  readonly onPick: (theme: ThemeChoice | undefined) => void;
}): ReactNode {
  const { label, value, themes, none, clearable, onPick } = props;
  const known = themes.some((t) => themeRecordId(t.name) === value);
  return (
    <label className="fx-chrome-pick">
      <span aria-hidden="true">{label}</span>
      <select
        className="fx-chrome-pick-select"
        aria-label={label}
        value={value}
        onChange={(e) => onPick(themes.find((t) => themeRecordId(t.name) === e.target.value))}
      >
        <option value="" disabled={clearable === false && value !== ''}>
          {none}
        </option>
        {value !== '' && !known ? <option value={value}>{value} (custom)</option> : null}
        {themes.map((t) => (
          <option key={t.name} value={themeRecordId(t.name)}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The two selects: the document's theme and the open screen's override.
 *
 * @public
 */
export function ThemeSwitcher(props: ThemeSwitcherProps): ReactNode {
  const { store, execute, themes, screenId } = props;
  const docId = store.members('byType', 'document')[0] ?? '';
  const doc = useValue(useMemo(() => store.record$(docId as RecordId), [store, docId]));
  const screen = useValue(useMemo(() => store.record$((screenId ?? '') as RecordId), [store, screenId]));
  if (themes.length === 0) return null;
  return (
    <>
      <ThemeSelect
        label="Theme"
        value={idOf(doc)}
        themes={themes}
        none="Default"
        clearable={false}
        onPick={(t) => {
          if (t !== undefined) execute('document.setTheme', { theme: body(t) });
        }}
      />
      {screenId === undefined ? null : (
        <ThemeSelect
          label="Screen theme"
          value={idOf(screen)}
          themes={themes}
          none="Follows the document"
          clearable
          onPick={(t) => execute('screen.setThemeOverride', t === undefined ? { id: screenId } : { id: screenId, theme: body(t) })}
        />
      )}
    </>
  );
}
