// The credits of the shape packs a document uses (NFR-LIC-003, ADR-0050, M18.143): each pack's licence and attribution and every applicable source credit
// with its notice, read from the records the file embeds, so it works offline. Every field is untrusted text and is drawn as text: no markup, and a source
// reference becomes a link only when it is an http(s) URL, opened on a click, never fetched.
import type { ShapePackCredit, ShapePackFontCredit, ShapePackSource, VersionedShapePackSubset } from '@fluxion/core';
import type { ReactNode } from 'react';

/**
 * One used pack's credits: its identity, licence and attribution, and the source credits that apply to the definitions used.
 *
 * @public
 */
export type CreditedPack = {
  /** The pack's namespace. */
  readonly id: string;
  /** Its display name, when the host knows it (a saved subset carries none). */
  readonly name?: string;
  /** The exact pack version. */
  readonly version: string;
  /** The pack's SPDX licence expression. */
  readonly license: string;
  /** The pack's attribution. */
  readonly attribution: string;
  /** Every applicable source credit, notices included. */
  readonly credits: readonly ShapePackCredit[];
  /** The rights of the fonts the used artwork keeps (a 1.1 pack, ADR-0192), notices included; absent when there are none. */
  readonly fontCredits?: readonly ShapePackFontCredit[];
};

/**
 * The words of the credits list, in the page's language.
 *
 * @public
 */
export type CreditsLabels = {
  /** Before a licence expression. */
  readonly license: string;
  /** Before a font credit's attribution. */
  readonly font: string;
  /** Before a source. */
  readonly source: string;
  /** Before an upstream revision. */
  readonly revision: string;
  /** Before a description of modifications. */
  readonly modifications: string;
  /** How many of the pack's shapes a scoped credit covers. */
  readonly appliesTo: (count: number) => string;
};

/**
 * The words the credits list uses unless the page gives its own.
 *
 * @public
 */
export const DEFAULT_CREDITS_LABELS: CreditsLabels = {
  license: 'Licence',
  font: 'Font',
  source: 'Source',
  revision: 'Revision',
  modifications: 'Modifications',
  appliesTo: (count) => (count === 1 ? 'Applies to 1 shape' : `Applies to ${count} shapes`),
};

/**
 * The credits of saved shape-pack subsets, one per pack, ordered by pack id; `names` gives display names by pack id.
 *
 * @public
 */
export function creditedPacks(subsets: readonly VersionedShapePackSubset[], names: ReadonlyMap<string, string> = new Map()): CreditedPack[] {
  return [...subsets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => {
      const name = names.get(s.id);
      const fontCredits = s.formatVersion === '1.1' ? s.fontCredits : [];
      return {
        id: s.id,
        ...(name === undefined ? {} : { name }),
        version: s.version,
        license: s.license,
        attribution: s.attribution,
        credits: s.credits,
        ...(fontCredits.length === 0 ? {} : { fontCredits }),
      };
    });
}

/** Whether `reference` is a link a reader may follow: an absolute http(s) URL, nothing else. */
export const isWebLink = (reference: string): boolean => {
  try {
    const url = new URL(reference);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

function Source(props: { readonly source: ShapePackSource; readonly labels: CreditsLabels }): ReactNode {
  const { source, labels } = props;
  if (source.kind === 'original')
    return (
      <p part="credit-source">
        {labels.source}: {source.author}. {source.statement}
      </p>
    );
  return (
    <p part="credit-source">
      {labels.source}:{' '}
      {isWebLink(source.reference) ? (
        <a href={source.reference} target="_blank" rel="noopener noreferrer">
          {source.reference}
        </a>
      ) : (
        source.reference
      )}
      {source.revision === undefined ? null : ` (${labels.revision} ${source.revision})`}
      {source.modifications === undefined ? null : `. ${labels.modifications}: ${source.modifications}`}
    </p>
  );
}

/**
 * The credits list: one section per pack, then each source credit with its notice.
 *
 * @public
 */
export function PackCreditsList(props: { readonly packs: readonly CreditedPack[]; readonly labels?: Partial<CreditsLabels> }): ReactNode {
  const labels = { ...DEFAULT_CREDITS_LABELS, ...props.labels };
  return (
    <div part="credits-list" data-testid="pack-credits">
      {props.packs.map((pack) => (
        <section key={pack.id} part="credits-pack" aria-label={pack.name ?? pack.id}>
          <h3>
            {pack.name ?? pack.id} {pack.version}
          </h3>
          <p>
            {pack.attribution}. {labels.license}: {pack.license}
          </p>
          <ul>
            {pack.credits.map((credit) => (
              <li key={credit.id} part="credit">
                <p>
                  <strong>{credit.attribution}</strong>. {labels.license}: {credit.license}
                  {credit.definitionIds === undefined ? null : `. ${labels.appliesTo(credit.definitionIds.length)}`}
                </p>
                <Source source={credit.source} labels={labels} />
                <pre part="credit-notice" style={{ whiteSpace: 'pre-wrap' }}>
                  {credit.notice}
                </pre>
              </li>
            ))}
            {(pack.fontCredits ?? []).map((credit) => (
              <li key={`font:${credit.id}`} part="font-credit">
                <p>
                  {labels.font}: <strong>{credit.attribution}</strong>. {labels.license}: {credit.license}. {labels.appliesTo(credit.definitionIds.length)}
                </p>
                <Source source={credit.source} labels={labels} />
                <pre part="credit-notice" style={{ whiteSpace: 'pre-wrap' }}>
                  {credit.notice}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
