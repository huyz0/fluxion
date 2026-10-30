// The studio's credits of the shape packs a document uses (NFR-LIC-003, ADR-0050, M18.143): the packs the opened file embeds keep the credits the
// file pins, and the packs the library loaded give their index's credits; either way only the credits that apply to a definition the document uses
// now, scoped lists trimmed to those definitions, as a portable save would embed them. Shown in a dialog from the toolbar, as text (the player's list).
import type { ShapePackCredit, ShapePackFontCredit, Store, VersionedShapePackSubset } from '@fluxion/core';
import type { ShapePackSourceData } from '@fluxion/format';
import { type CreditedPack, type CreditsLabels, PackCreditsList } from '@fluxion/player';
import { plural, t } from '@lingui/core/macro';
import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from 'react';
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

/** A pack's font credits: a 1.1 pack's, none for 1.0. */
const fontCreditsOf = (pack: { readonly formatVersion: string } & Partial<{ readonly fontCredits: readonly ShapePackFontCredit[] }>) =>
  pack.formatVersion === '1.1' ? (pack.fontCredits ?? []) : [];

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
 * nothing behind it), Escape closes it, Tab cycles through its links and buttons, and F5 does not reload the page.
 */
function dialogKeys(e: KeyboardEvent<HTMLElement>, close: () => void): void {
  e.stopPropagation();
  if (e.key === 'F5') e.preventDefault();
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab') return;
  const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')];
  const [first, last] = [controls[0], controls.at(-1)];
  if (document.activeElement !== (e.shiftKey ? first : last)) return;
  e.preventDefault();
  (e.shiftKey ? last : first)?.focus();
}

/** The credits dialog: every used pack's credits, or a line saying there are none; it takes the focus, and Escape or Close closes it. */
export function PackCreditsDialog(props: { readonly packs: readonly CreditedPack[]; readonly onClose: () => void }): JSX.Element {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <dialog
      open
      aria-label={t`Shape credits`}
      onKeyDown={(e) => dialogKeys(e, props.onClose)}
      // a clipboard chord in the dialog is not a cut or paste of the selection behind it
      onCut={(e) => e.stopPropagation()}
      onCopy={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
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
  const show = () => setCredits(documentCredits(saved, sources(), usedDefIds(store.toDocument().records), names));
  return (
    <>
      <button ref={button} type="button" aria-pressed={credits !== undefined} onClick={() => (credits === undefined ? show() : setCredits(undefined))}>
        {t`Credits`}
      </button>
      {credits === undefined ? null : (
        <PackCreditsDialog
          packs={credits}
          onClose={() => {
            setCredits(undefined);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}
