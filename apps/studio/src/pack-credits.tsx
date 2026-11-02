// The studio's credits of the shape packs a document uses (NFR-LIC-003, ADR-0050, M18.143): the packs the opened file embeds keep the credits the
// file pins, and the packs the library loaded give their index's credits; either way only the credits that apply to a definition the document uses
// now, scoped lists trimmed to those definitions, as a portable save would embed them. Shown in a dialog from the toolbar, as text (the player's list).
import { packHasFonts, type ShapePackCredit, type ShapePackFontCredit, type Store, type VersionedShapePackSubset } from '@fluxion/core';
import type { ShapePackSourceData } from '@fluxion/format';
import { type CreditedPack, type CreditsLabels, PackCreditsList } from '@fluxion/player';
import { plural, t } from '@lingui/core/macro';
import { type JSX, type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { type DocumentCatalog, usedDefIds } from './pack-catalog.js';

/** A pack's rights as the credits need them, with the ids of its definitions at hand. */
type Rights = {
  readonly id: string;
  readonly version: string;
  readonly license: string;
  readonly attribution: string;
  readonly credits: readonly ShapePackCredit[];
  readonly fontCredits: readonly ShapePackFontCredit[];
  readonly definitions: readonly string[];
  /** The display name a distribution's index gives (an imported SVG library's, M18.17). */
  readonly name?: string | undefined;
};

/** A pack's font credits: a 1.1 or 1.2 pack's, none for 1.0. */
const fontCreditsOf = (pack: { readonly formatVersion: string } & Partial<{ readonly fontCredits: readonly ShapePackFontCredit[] }>) =>
  packHasFonts(pack) ? (pack.fontCredits ?? []) : [];

/** The credits of `pack` that apply to the used definitions, scoped lists trimmed to them; undefined when it has no used definition. */
function applicable(pack: Rights, used: ReadonlySet<string>, name: string | undefined): CreditedPack | undefined {
  if (!pack.definitions.some((id) => used.has(id))) return undefined;
  const credits = pack.credits.flatMap((credit) => {
    if (credit.definitionIds === undefined) return [credit];
    const definitionIds = credit.definitionIds.filter((id) => used.has(id));
    return definitionIds.length === 0 ? [] : [{ ...credit, definitionIds }];
  });
  // a font credit is scoped to the definitions whose artwork keeps the font
  const fontCredits = pack.fontCredits.flatMap((credit) => {
    const definitionIds = credit.definitionIds.filter((id) => used.has(id));
    return definitionIds.length === 0 ? [] : [{ ...credit, definitionIds }];
  });
  return {
    id: pack.id,
    ...(name === undefined ? {} : { name }),
    version: pack.version,
    license: pack.license,
    attribution: pack.attribution,
    credits,
    ...(fontCredits.length === 0 ? {} : { fontCredits }),
  };
}

/**
 * The credits of the packs the document uses: those `saved` in its file, then those the library `loaded`, by pack id; a namespace the file
 * embeds is the file's, whatever the library has. `names` gives display names by pack id.
 */
export function documentCredits(
  saved: readonly VersionedShapePackSubset[],
  loaded: readonly ShapePackSourceData[],
  used: Iterable<string>,
  names: ReadonlyMap<string, string> = new Map(),
): CreditedPack[] {
  const inUse = new Set(used);
  const rights = new Map<string, Rights>();
  for (const s of saved) rights.set(s.id, { ...s, fontCredits: fontCreditsOf(s), definitions: s.definitions.map((d) => d.id) });
  for (const source of loaded) {
    const pack =
      source.kind === 'distribution'
        ? { ...source.index, fontCredits: fontCreditsOf(source.index), definitions: source.definitions.map((d) => d.id) }
        : undefined;
    if (pack !== undefined && !rights.has(pack.id)) rights.set(pack.id, pack);
  }
  return [...rights.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((pack) => applicable(pack, inUse, names.get(pack.id) ?? pack.name) ?? []);
}

/** The credits list's words in the studio's language. */
function creditsLabels(): CreditsLabels {
  return {
    license: t`Licence`,
    font: t`Font`,
    source: t`Source`,
    revision: t`Revision`,
    modifications: t`Modifications`,
    appliesTo: (count) => plural(count, { one: 'Applies to # shape', other: 'Applies to # shapes' }),
  };
}

/**
 * Keys in the credits dialog stay in it, as in the editor's own dialogs: none reaches the canvas's shortcuts (the arrows scroll the dialog, Delete deletes
 * nothing behind it, undo and redo undo nothing behind it), Escape closes it, Tab cycles through its links and buttons, and F5 does not reload the page. Tab is always moved here, never
 * left to the browser: WebKit's own Tab skips buttons and links, so from anywhere in the dialog but the last control it would leave the dialog for the
 * next text field (ci 41127689125, M18.213).
 */
function dialogKeys(e: KeyboardEvent<HTMLElement>, close: () => void): void {
  e.stopPropagation();
  if (e.key === 'F5') e.preventDefault();
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  // undo and redo are not the browser's either: WebKit's native undo is document-wide, so Ctrl/Cmd+Z on a button would undo the text typed into a
  // field behind the dialog (the library search) and move the focus there (ci 41127689125)
  if (undoChord(e)) e.preventDefault();
  if (e.key !== 'Tab') return;
  e.preventDefault();
  nextControl(e.currentTarget, e.shiftKey)?.focus();
}

/** Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z or Ctrl/Cmd+Y. */
const undoChord = (e: KeyboardEvent<HTMLElement>): boolean => (e.ctrlKey || e.metaKey) && !e.altKey && ['z', 'y'].includes(e.key.toLowerCase());

/** The control Tab (or Shift+Tab, `back`) moves to in `dialog`: the next one in order, wrapping; the first (or last) from anywhere else. */
function nextControl(dialog: HTMLElement, back: boolean): HTMLElement | undefined {
  const controls = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
  const at = controls.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return back ? controls.at(-1) : controls[0];
  return controls[(at + (back ? -1 : 1) + controls.length) % controls.length];
}

/**
 * While the dialog is open the focus stays in it: a focus that lands outside (a click behind it, an engine's own Tab from the page) goes back to its
 * Close button, so the keys stay the dialog's and Escape can return the focus to the Credits button (M18.213).
 */
function useFocusKept(dialog: RefObject<HTMLDialogElement | null>, close: RefObject<HTMLButtonElement | null>): void {
  useEffect(() => {
    const keep = (e: FocusEvent) => {
      if (e.target instanceof Node && dialog.current !== null && !dialog.current.contains(e.target)) close.current?.focus();
    };
    document.addEventListener('focusin', keep);
    return () => document.removeEventListener('focusin', keep);
  }, [dialog, close]);
}

/**
 * While the dialog is open a clipboard chord is not a cut or paste of the selection behind it. Held on the window, before the editor's listeners:
 * Firefox raises copy, cut and paste on the body when the focus is on a button (a non-editable target), so a handler on the dialog never sees them
 * (ci 41117375355, M18.213). A copy of text selected in the dialog still copies it: only the editor's handling is held, not the browser's.
 */
function useClipboardHeld(): void {
  useEffect(() => {
    const hold = (e: Event) => e.stopPropagation();
    for (const type of ['copy', 'cut', 'paste']) window.addEventListener(type, hold, true);
    return () => {
      for (const type of ['copy', 'cut', 'paste']) window.removeEventListener(type, hold, true);
    };
  }, []);
}

/** The credits dialog: every used pack's credits, or a line saying there are none; it takes the focus, and Escape or Close closes it. */
export function PackCreditsDialog(props: { readonly packs: readonly CreditedPack[]; readonly onClose: () => void }): JSX.Element {
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => close.current?.focus(), []);
  useFocusKept(dialog, close);
  useClipboardHeld();
  return (
    <dialog
      ref={dialog}
      open
      aria-label={t`Shape credits`}
      onKeyDown={(e) => dialogKeys(e, props.onClose)}
      style={{ position: 'fixed', top: 48, zIndex: 10_000, maxWidth: 640, maxHeight: '75vh', overflow: 'auto', padding: 16 }}
    >
      <h2 style={{ marginTop: 0 }}>{t`Shape credits`}</h2>
      {props.packs.length === 0 ? (
        <p>{t`This document uses no shapes from a shape pack.`}</p>
      ) : (
        <PackCreditsList packs={props.packs} labels={creditsLabels()} />
      )}
      <button ref={close} type="button" className="fx-chrome-button" onClick={props.onClose}>
        {t`Close`}
      </button>
    </dialog>
  );
}

/**
 * The toolbar's Credits button and its dialog; the credits are read when it opens, from what the document uses then, and closing it puts the
 * focus back on the button.
 */
export function CreditsButton(props: {
  readonly store: Store;
  readonly saved: readonly VersionedShapePackSubset[];
  /** The sources a save would embed now (imported libraries, loaded first-party definitions): the dialog lists the same packs. */
  readonly sources: () => readonly ShapePackSourceData[];
  /** The catalog's pack names by namespace. */
  readonly names?: DocumentCatalog['names'] | undefined;
}): JSX.Element {
  const { store, saved, sources, names } = props;
  const [credits, setCredits] = useState<readonly CreditedPack[] | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  // the focus goes back to the button once the dialog has gone (its focus keeping no longer holds it), however it was closed
  const wasOpen = useRef(false);
  useEffect(() => {
    if (credits === undefined && wasOpen.current) button.current?.focus();
    wasOpen.current = credits !== undefined;
  }, [credits]);
  const show = () => setCredits(documentCredits(saved, sources(), usedDefIds(store.toDocument().records), names));
  return (
    <>
      <button ref={button} type="button" aria-pressed={credits !== undefined} onClick={() => (credits === undefined ? show() : setCredits(undefined))}>
        {t`Credits`}
      </button>
      {credits === undefined ? null : <PackCreditsDialog packs={credits} onClose={() => setCredits(undefined)} />}
    </>
  );
}
