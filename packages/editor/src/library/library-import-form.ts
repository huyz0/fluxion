// The Import SVG dialog's declaration (FR-LIB-004, NFR-LIC-003, M18.176): the pack identity and the rights, as the person types
// them. Rights are declared, never inferred: a credits file (its notices inline), the person's own work, or an upstream source with
// its SHA-256 typed. A declaration missing any part is refused here, before anything is converted.
import { parseImportCredits } from '@fluxion/format';
import { t } from '@lingui/core/macro';
import '../i18n.js';
import type { SvgLibraryRights } from './import-svg.js';
import type { SvgLibraryInput } from './import-svg-input.js';
import type { LibraryImportRequest } from './library-importer.js';

/** Which rights form the person fills in. */
export type RightsKind = 'credits' | 'original' | 'upstream';

/** The dialog's fields, as typed. */
export type LibraryImportForm = {
  readonly namespace: string;
  readonly version: string;
  readonly name: string;
  readonly kind: RightsKind;
  /** The credits file's text, once picked. */
  readonly creditsText?: string | undefined;
  readonly license: string;
  readonly attribution: string;
  readonly author: string;
  readonly reference: string;
  readonly sha256: string;
};

/** `My Icons.zip` → `my-icons`: a namespace from the first picked name. */
export const namespaceOf = (input: SvgLibraryInput): string =>
  (input.items[0]?.name.split('/').at(-1) ?? '')
    .replace(/\.(svg|zip)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The fields a fresh dialog starts with: the namespace from the first name, version 1.0.0, no rights and no license. */
export function initialForm(input: SvgLibraryInput): LibraryImportForm {
  const namespace = namespaceOf(input);
  return { namespace, version: '1.0.0', name: namespace, kind: 'original', license: '', attribution: '', author: '', reference: '', sha256: '' };
}

const blank = (value: string) => value.trim() === '';

/** The rights the one-credit forms declare, or what is missing. */
function oneCredit(form: LibraryImportForm): SvgLibraryRights | string[] {
  const missing = [...(blank(form.license) ? [t`Choose the license of the SVGs.`] : []), ...(blank(form.attribution) ? [t`Give the attribution.`] : [])];
  if (form.kind === 'original') {
    if (blank(form.author)) missing.push(t`Give the author's name.`);
    return missing.length ? missing : { kind: 'original', license: form.license, attribution: form.attribution, author: form.author };
  }
  if (blank(form.reference)) missing.push(t`Give where the source is.`);
  if (!/^[0-9a-f]{64}$/.test(form.sha256.trim())) missing.push(t`Give the source's SHA-256 as 64 lowercase hex digits.`);
  return missing.length
    ? missing
    : { kind: 'upstream', license: form.license, attribution: form.attribution, reference: form.reference, sha256: form.sha256.trim() };
}

/** The declared rights, or every reason the declaration is not complete. */
function rightsOf(form: LibraryImportForm): SvgLibraryRights | string[] {
  if (form.kind !== 'credits') return oneCredit(form);
  if (form.creditsText === undefined) return [t`Choose a credits file.`];
  let json: unknown;
  try {
    json = JSON.parse(form.creditsText);
  } catch {
    return [t`The credits file is not JSON.`];
  }
  const parsed = parseImportCredits(json);
  return 'kind' in parsed ? [t`The credits file is not valid: ${parsed.message}`] : { kind: 'credits', credits: parsed };
}

/** The request the form declares, or every problem with it; nothing is converted while there is one. */
export function requestOf(form: LibraryImportForm): LibraryImportRequest | string[] {
  const identity = [
    ...(blank(form.namespace) ? [t`Give the namespace.`] : []),
    ...(blank(form.version) ? [t`Give the version.`] : []),
    ...(blank(form.name) ? [t`Give the name.`] : []),
  ];
  const rights = rightsOf(form);
  const problems = [...identity, ...(Array.isArray(rights) ? rights : [])];
  if (problems.length || Array.isArray(rights)) return problems;
  return { namespace: form.namespace.trim(), version: form.version.trim(), name: form.name.trim(), rights };
}
