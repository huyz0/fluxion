// The CodeMirror language of the source view (FR-DSL-009, ADR-0032): `@codemirror/lang-yaml`'s Lezer grammar with the FluxScript layer on top.
// The layer is a view plugin that marks the ranges `fluxScriptTokens` computes, so the highlighting is the compiler's own tokenizer's. Part of
// the lazy source-view chunk: nothing in the editor's initial chunk imports this file.
import { yaml } from '@codemirror/lang-yaml';
import { LanguageSupport } from '@codemirror/language';
import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type FluxScriptTokenClass, fluxScriptTokens } from './fluxscript-tokens.js';

const MARKS: { readonly [C in FluxScriptTokenClass]: Decoration } = {
  'fx-key': Decoration.mark({ class: 'fx-key' }),
  'fx-key-deferred': Decoration.mark({ class: 'fx-key-deferred' }),
  'fx-op': Decoration.mark({ class: 'fx-op' }),
  'fx-slug': Decoration.mark({ class: 'fx-slug' }),
  'fx-anchor': Decoration.mark({ class: 'fx-anchor' }),
  'fx-pack': Decoration.mark({ class: 'fx-pack' }),
  'fx-shape': Decoration.mark({ class: 'fx-shape' }),
};

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const t of fluxScriptTokens(view.state.doc.toString())) builder.add(t.from, t.to, MARKS[t.class]);
  return builder.finish();
}

/** The FluxScript layer alone: marks edge ops, slugs, anchors, keys, shape ids and packs with the `fx-*` classes. */
const fluxScriptLayer: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.decorations = decorate(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * The language of the source view: the YAML language (Lezer grammar, indentation, folding) and the FluxScript layer over it.
 *
 * @returns a CodeMirror language extension
 */
export function fluxScriptLanguage(): LanguageSupport {
  const base = yaml();
  return new LanguageSupport(base.language, [base.support, fluxScriptLayer]);
}
