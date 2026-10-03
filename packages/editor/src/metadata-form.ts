// The metadata form (FR-DOC-006, M9.18): the document record's title, description, language, authors, tags and custom key-values as
// the dialog edits them (text), and back into the fields `document.updateMeta` takes, with what is wrong with the text.

/**
 * The metadata as text fields: authors and tags comma separated, custom as rows.
 *
 * @public
 */
export type MetadataForm = {
  /** The title. */
  readonly title: string;
  /** The description. */
  readonly description: string;
  /** The BCP 47 language tag. */
  readonly lang: string;
  /** Author names, comma separated. */
  readonly authors: string;
  /** Tags, comma separated. */
  readonly tags: string;
  /** Custom key-value pairs, in order. */
  readonly custom: readonly {
    /** The field's name. */
    readonly key: string;
    /** The field's value. */
    readonly value: string;
  }[];
};

/**
 * The fields `document.updateMeta` takes, from a valid form: an empty text is an absent field.
 *
 * @public
 */
export type MetadataFields = {
  /** The title. */
  readonly title: string | undefined;
  /** The description. */
  readonly description: string | undefined;
  /** The language tag. */
  readonly lang: string | undefined;
  /** The author names. */
  readonly authors: readonly string[] | undefined;
  /** The tags. */
  readonly tags: readonly string[] | undefined;
  /** The custom key-value pairs. */
  readonly custom: { readonly [key: string]: string } | undefined;
};

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** A BCP 47 tag, loosely: a 2 to 3 letter language and subtags of 1 to 8 letters or digits (singletons such as `u` and `x` included). */
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/**
 * The form of a `document` record (an absent record gives an empty form).
 *
 * @public
 */
export function metadataForm(record: { readonly [field: string]: unknown } | undefined): MetadataForm {
  const custom = record?.['custom'];
  const entries = typeof custom === 'object' && custom !== null && !Array.isArray(custom) ? Object.entries(custom as { readonly [key: string]: unknown }) : [];
  return {
    title: text(record?.['title']),
    description: text(record?.['description']),
    lang: text(record?.['lang']),
    authors: list(record?.['authors']).join(', '),
    tags: list(record?.['tags']).join(', '),
    custom: entries.flatMap(([key, value]) => (typeof value === 'string' ? [{ key, value }] : [])),
  };
}

/** The items of a comma separated text, trimmed, empty ones and repeats dropped. */
const items = (value: string): string[] => [
  ...new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  ),
];

/**
 * What is wrong with `form`, by field (the language tag, an empty or repeated custom key); none when it can be saved.
 *
 * @public
 */
export function metadataProblems(form: MetadataForm): {
  /** What is wrong with the language tag. */
  readonly lang?: string;
  /** What is wrong with the custom fields. */
  readonly custom?: string;
} {
  const lang = form.lang.trim() !== '' && !LANG.test(form.lang.trim()) ? 'a language tag such as en or pt-BR' : undefined;
  const keys = form.custom.map((c) => c.key.trim());
  const custom = keys.some((k) => k === '')
    ? 'every custom field needs a name'
    : new Set(keys).size !== keys.length
      ? 'custom field names must differ'
      : undefined;
  return { ...(lang !== undefined && { lang }), ...(custom !== undefined && { custom }) };
}

/**
 * The fields of a form that has no problems (see {@link metadataProblems}).
 *
 * @public
 */
export function metadataFields(form: MetadataForm): MetadataFields {
  const trimmed = (v: string) => (v.trim() === '' ? undefined : v.trim());
  const authors = items(form.authors);
  const tags = items(form.tags);
  const custom = Object.fromEntries(form.custom.map((c) => [c.key.trim(), c.value]));
  return {
    title: trimmed(form.title),
    description: trimmed(form.description),
    lang: trimmed(form.lang),
    authors: authors.length === 0 ? undefined : authors,
    tags: tags.length === 0 ? undefined : tags,
    custom: Object.keys(custom).length === 0 ? undefined : custom,
  };
}
