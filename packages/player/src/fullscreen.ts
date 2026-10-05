// Full screen (FR-PRS-001): the Fullscreen API where the page has it, its WebKit-prefixed form where only that exists, and nothing where neither does (iPhone
// Safari has no element fullscreen): the deck already fills the viewport, and the page's `viewport-fit=cover` takes the notch. No view in it: a host passes the
// element and the document, so it is tested with plain objects.

/**
 * The part of a document the fullscreen state is read and left through.
 *
 * @public
 */
export type FullscreenDocument = {
  /** The element in fullscreen, if one. */
  readonly fullscreenElement?: Element | null;
  /** The same in WebKit's prefixed form. */
  readonly webkitFullscreenElement?: Element | null;
  /** Leave fullscreen. */
  exitFullscreen?(): Promise<void>;
  /** The same in WebKit's prefixed form. */
  webkitExitFullscreen?(): void | Promise<void>;
};

/**
 * The part of an element it is put in fullscreen through.
 *
 * @public
 */
export type FullscreenTarget = {
  /** Put the element in fullscreen (the browser may refuse without a user gesture). */
  requestFullscreen?(options?: { navigationUI?: 'hide' | 'show' | 'auto' }): Promise<void>;
  /** The same in WebKit's prefixed form. */
  webkitRequestFullscreen?(): void | Promise<void>;
};

/**
 * What a toggle came to: `entered` or `exited` the full screen; `unsupported` where the page cannot (the deck then stays as it is, filling the viewport); `refused`
 * where the browser said no (a request needs a user gesture).
 *
 * @public
 */
export type FullscreenResult = 'entered' | 'exited' | 'unsupported' | 'refused';

/** Whether `target` can be put in fullscreen on this page. */
export function fullscreenSupported(target: FullscreenTarget): boolean {
  return typeof target.requestFullscreen === 'function' || typeof target.webkitRequestFullscreen === 'function';
}

/** Whether the page is in fullscreen now. */
export function isFullscreen(doc: FullscreenDocument): boolean {
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
}

/**
 * Put `target` in fullscreen, or leave it when the page already is. Never rejects.
 *
 * @public
 */
export async function toggleFullscreen(target: FullscreenTarget, doc: FullscreenDocument): Promise<FullscreenResult> {
  try {
    if (isFullscreen(doc)) {
      if (doc.exitFullscreen !== undefined) await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen !== undefined) await doc.webkitExitFullscreen();
      else return 'unsupported';
      return 'exited';
    }
    if (target.requestFullscreen !== undefined) await target.requestFullscreen({ navigationUI: 'hide' });
    else if (target.webkitRequestFullscreen !== undefined) await target.webkitRequestFullscreen();
    else return 'unsupported';
    return 'entered';
  } catch {
    return 'refused';
  }
}
