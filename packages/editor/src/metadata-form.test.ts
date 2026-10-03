import { describe, expect, it } from 'vitest';
import { metadataFields, metadataForm, metadataProblems } from './metadata-form.js';

describe('the metadata form (FR-DOC-006)', () => {
  it('FR-DOC-006: a document record becomes text fields and back into the fields updateMeta takes', () => {
    const form = metadataForm({
      title: 'Deck',
      description: 'About',
      lang: 'pt-BR',
      authors: ['Ada', 'Grace'],
      tags: ['a', 'b'],
      custom: { team: 'x', ref: '7' },
    });
    expect(form).toEqual({
      title: 'Deck',
      description: 'About',
      lang: 'pt-BR',
      authors: 'Ada, Grace',
      tags: 'a, b',
      custom: [
        { key: 'team', value: 'x' },
        { key: 'ref', value: '7' },
      ],
    });
    expect(metadataProblems(form)).toEqual({});
    expect(metadataFields(form)).toEqual({
      title: 'Deck',
      description: 'About',
      lang: 'pt-BR',
      authors: ['Ada', 'Grace'],
      tags: ['a', 'b'],
      custom: { team: 'x', ref: '7' },
    });
  });

  it('FR-DOC-006: empty text is an absent field, lists are trimmed and deduplicated, a record with nothing gives an empty form', () => {
    expect(metadataForm(undefined)).toEqual({ title: '', description: '', lang: '', authors: '', tags: '', custom: [] });
    const fields = metadataFields({ title: '  ', description: '', lang: ' ', authors: ' Ada ,, Ada , ', tags: '', custom: [] });
    expect(fields).toEqual({ title: undefined, description: undefined, lang: undefined, authors: ['Ada'], tags: undefined, custom: undefined });
    // values that are not the expected type are ignored
    expect(metadataForm({ title: 5, authors: 'x', tags: [1, 'ok'], custom: { a: 1, b: 'two' } })).toMatchObject({
      title: '',
      authors: '',
      tags: 'ok',
      custom: [{ key: 'b', value: 'two' }],
    });
    expect(metadataForm({ custom: ['no'] }).custom).toEqual([]);
  });

  it('FR-DOC-006: a bad language tag, an empty or a repeated custom name is a problem; a good tag and distinct names are not', () => {
    const base = { title: '', description: '', lang: '', authors: '', tags: '', custom: [] };
    expect(metadataProblems({ ...base, lang: 'en' })).toEqual({});
    expect(metadataProblems({ ...base, lang: 'zh-Hant-TW' })).toEqual({});
    expect(metadataProblems({ ...base, lang: 'english language' }).lang).toMatch(/language tag/);
    expect(metadataProblems({ ...base, lang: 'de-u-co-phonebk' })).toEqual({});
    expect(metadataProblems({ ...base, lang: 'e' }).lang).toBeDefined();
    expect(metadataProblems({ ...base, custom: [{ key: ' ', value: 'x' }] }).custom).toMatch(/needs a name/);
    expect(
      metadataProblems({
        ...base,
        custom: [
          { key: 'a', value: '1' },
          { key: ' a ', value: '2' },
        ],
      }).custom,
    ).toMatch(/must differ/);
    expect(
      metadataProblems({
        ...base,
        custom: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
        ],
      }),
    ).toEqual({});
  });
});
