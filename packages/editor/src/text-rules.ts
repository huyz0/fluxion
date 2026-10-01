// Markdown shortcuts of the inline text editor (FR-TXT-004, M7.13): typing `# ` starts a heading, `- ` or
// `* ` a bullet list, `1. ` a numbered one, and `**bold**`, `_italic_` and `` `code` `` mark what they wrap.
// Each is a ProseMirror input rule, one undo step of the editor's own history that Ctrl+Z takes back as
// a whole (the history's first undo of a rule gives the typed characters back, `undoInputRule`).
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { MarkType } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { TEXT_SCHEMA } from './text-schema.js';

const { heading, bulletList, orderedList } = TEXT_SCHEMA.nodes;

/** A rule marking what `pattern` wraps (its first group) with `mark` and dropping the markers; typing the closing marker is what fires it. */
function markRule(pattern: RegExp, mark: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const inner = match[1] ?? '';
    const tr = state.tr.delete(start, end).insertText(inner, start);
    return tr.addMark(start, start + inner.length, mark.create()).removeStoredMark(mark);
  });
}

/** The input rules plugin. */
export function markdownRules(): Plugin {
  const marks = TEXT_SCHEMA.marks;
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, heading as never, (m) => ({ level: (m[1] ?? '#').length })),
      wrappingInputRule(/^\s*([-+*])\s$/, bulletList as never),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        orderedList as never,
        // a list starting at 1 stores no start
        (m) => (Number(m[1]) === 1 ? {} : { start: Number(m[1]) }),
        (m, node) => node.childCount + Number(node.attrs['start'] ?? 1) === Number(m[1]),
      ),
      markRule(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, marks['bold'] as MarkType),
      markRule(/(?<![_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, marks['italic'] as MarkType),
      markRule(/`([^`]+)`$/, marks['code'] as MarkType),
    ],
  });
}
