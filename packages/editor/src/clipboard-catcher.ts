// The editable target a clipboard chord goes through (FR-EDT-007, NFR-PORT-001, M18.132). Some engines raise `copy`, `cut` and `paste` for Ctrl/Cmd+C, X and V only from an
// editable field (WebKit 26.5: scripts/ci/clipboard-events-probe.mjs, nightly 40470089950), and their async clipboard read is refused, so a paste from another document has no
// way in. On the chord's keydown the focus moves to a hidden text area with its one character selected; the browser's default action then raises the event there, on every engine
// alike, and the editor's handler takes it as its own. The focus, and the page's text selection, go back where they were as soon as the event is handled, or when no
// event came.

/** The hidden target of one editor. */
export type ClipboardCatcher = {
  /** Take the focus for a chord, remembering where it was. */
  route(): void;
  /** Whether a clipboard event's target is this catcher. */
  owns(target: EventTarget | null): boolean;
  /** Give the focus and the page's text selection back as they were before {@link ClipboardCatcher.route}, if the catcher still has the focus. */
  restore(): void;
  /** Remove the text area. */
  dispose(): void;
};

/** A catcher in `doc`, made on the first chord. */
export function clipboardCatcher(doc: Document): ClipboardCatcher {
  let area: HTMLTextAreaElement | undefined;
  let before: HTMLElement | undefined;
  let ranges: Range[] = [];
  const make = (): HTMLTextAreaElement => {
    const made = doc.createElement('textarea');
    made.setAttribute('aria-hidden', 'true');
    made.tabIndex = -1;
    made.dataset['fxClipboardCatcher'] = '';
    // out of sight and out of the layout, but focusable (not display:none or visibility:hidden)
    made.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    doc.body.append(made);
    return made;
  };
  return {
    route() {
      area ??= make();
      const active = doc.activeElement;
      // routed again before it was given back: the focus to give back is still the first one
      if (active !== area) {
        before = active instanceof HTMLElement ? active : undefined;
        const selection = doc.getSelection();
        ranges = selection === null ? [] : Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
      }
      // a selection, so that an engine that copies only what is selected still raises the event; the handler prevents the default, so nothing of it is copied
      area.value = ' ';
      area.focus({ preventScroll: true });
      area.select();
    },
    owns: (target) => area !== undefined && target === area,
    restore() {
      if (area === undefined || doc.activeElement !== area) return;
      area.value = '';
      if (before?.isConnected) before.focus({ preventScroll: true });
      else area.blur();
      // selecting the placeholder replaced the page's selection
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
      before = undefined;
      ranges = [];
    },
    dispose() {
      area?.remove();
      area = undefined;
      before = undefined;
      ranges = [];
    },
  };
}
