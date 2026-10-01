// The view of a `text` element (FR-EDT-007, M7.8): its rich text drawn in its box, in the style
// resolved for text (the theme's font, colour and alignment), so a text element, however it came (a
// paste, an import, a hand-written file), is drawn and not a placeholder.
import type { TextElement } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type ReactNode, useMemo } from 'react';
import { labelStyle } from './label.js';
import type { ElementViewProps } from './registries.js';
import { RichText } from './rich-text.js';

/**
 * The built-in view for `text` elements.
 *
 * @public
 */
export function TextView(props: ElementViewProps): ReactNode {
  const { theme } = props;
  const element = props.element as TextElement;
  const { id } = element;
  // tzap disable next-line StringLiteral,ArrayDeclaration: the kind and the path only name the style for diagnostics (the theme's text defaults are its '*' ones), and the list only re-runs the memo
  const { style } = useMemo(() => resolveStyle(element.style, 'text', theme, ['records', id, 'style']), [element.style, theme, id]);
  return (
    <>
      <div className="fx-label fx-text" style={labelStyle(style.font, style.opacity)}>
        <RichText doc={element.text} />
      </div>
      {props.children}
    </>
  );
}
