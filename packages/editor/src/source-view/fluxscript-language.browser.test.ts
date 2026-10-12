import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { fluxScriptLanguage } from './fluxscript-language.js';

// T1 for FR-DSL-009 (M12.20): the language extension marks the layer's ranges in a real CodeMirror view and keeps them current on edits.
const DOC = 'flux: 1\nscreens:\n  - id: s\n    edges:\n      - a.e -> b\n';
let view: EditorView | undefined;
afterEach(() => view?.destroy());

const marked = (cls: string) => [...(view?.dom.querySelectorAll(`.${cls}`) ?? [])].map((e) => e.textContent);

describe('fluxScriptLanguage (FR-DSL-009, ADR-0032)', () => {
  it('FR-DSL-009: the language is YAML with the FluxScript layer, which marks ops, slugs and anchors in a view', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    view = new EditorView({ parent, state: EditorState.create({ doc: DOC, extensions: [fluxScriptLanguage()] }) });
    expect(fluxScriptLanguage().language.name).toBe('yaml');
    expect(marked('fx-op')).toEqual(['->']);
    expect(marked('fx-slug')).toEqual(['a', 'b']);
    expect(marked('fx-anchor')).toEqual(['e']);
    expect(marked('fx-key')).toEqual(expect.arrayContaining(['flux', 'screens', 'id', 'edges']));
  });

  it('FR-DSL-009: the marks follow an edit of the document', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    view = new EditorView({ parent, state: EditorState.create({ doc: DOC, extensions: [fluxScriptLanguage()] }) });
    const at = DOC.indexOf('->');
    view.dispatch({ changes: { from: at, to: at + 2, insert: '~>' } });
    expect(marked('fx-op')).toEqual(['~>']);
  });
});
