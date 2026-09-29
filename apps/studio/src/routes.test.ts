import { describe, expect, it } from 'vitest';
import { pathOf, routeOf } from './routes.js';

describe('studio routes (FR-EDT-001)', () => {
  it('FR-EDT-001: the studio routes to the home page, a document in the editor and a document presented', () => {
    expect(routeOf('/')).toEqual({ kind: 'home' });
    expect(routeOf('')).toEqual({ kind: 'home' });
    expect(routeOf('/edit/new')).toEqual({ kind: 'edit', docId: 'new' });
    expect(routeOf('/edit/example-shapes-gallery/')).toEqual({ kind: 'edit', docId: 'example-shapes-gallery' });
    expect(routeOf('/present/new')).toEqual({ kind: 'present', docId: 'new' });
    for (const bad of ['/edit/', '/edit/a/b', '/present/..', '/nope', '/edit/%2e%2e']) expect(routeOf(bad)).toEqual({ kind: 'not-found', path: bad });
    for (const r of [{ kind: 'home' }, { kind: 'edit', docId: 'x' }, { kind: 'present', docId: 'y' }] as const) expect(routeOf(pathOf(r))).toEqual(r);
  });
});
