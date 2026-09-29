// Studio routes (04 §4): the home page, a document in the editor, a document presented. History API
// paths, no router dependency; a document id is `new` or `example-<name>` until files arrive (M10).

/**
 * Where the studio is.
 *
 * @public
 */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'edit'; readonly docId: string }
  | { readonly kind: 'present'; readonly docId: string }
  | { readonly kind: 'not-found'; readonly path: string };

const DOC = /^\/(edit|present)\/([A-Za-z0-9_-]+)\/?$/;

/**
 * The route of the path `pathname`.
 *
 * @public
 */
export function routeOf(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  const m = DOC.exec(pathname);
  if (m === null) return { kind: 'not-found', path: pathname };
  return m[1] === 'edit' ? { kind: 'edit', docId: m[2] as string } : { kind: 'present', docId: m[2] as string };
}

/**
 * The path of `route` (the inverse of {@link routeOf} for the routes it can produce).
 *
 * @public
 */
export function pathOf(route: Exclude<Route, { kind: 'not-found' }>): string {
  return route.kind === 'home' ? '/' : `/${route.kind}/${route.docId}`;
}
