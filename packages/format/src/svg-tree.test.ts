import { expect, it } from 'vitest';
import { inspectSvg, inspectSvgTree, MAX_SVG_CHARS } from './sanitize-svg.js';

it('FR-LIB-004 NFR-SEC-001: importer receives decoded checked data without serialized markup or namespaces', () => {
  expect(
    inspectSvgTree('<svg xmlns="elsewhere" viewBox="1 2 30 40"><g id="a"><text>A &amp; B &lt;C&gt;</text><rect width="10" height="20"/></g></svg>'),
  ).toEqual({
    root: {
      name: 'svg',
      attributes: { viewBox: '1 2 30 40' },
      children: [
        {
          name: 'g',
          attributes: { id: 'a' },
          children: [
            { name: 'text', attributes: {}, children: ['A & B <C>'] },
            { name: 'rect', attributes: { width: '10', height: '20' }, children: [] },
          ],
        },
      ],
    },
    removed: 0,
  });
});

it('NFR-SEC-001: checked trees discard unsafe subtrees, attributes and declarations with the same diagnostics', () => {
  const input =
    '<!DOCTYPE svg [<!ENTITY bad "unsafe">]><svg onload="evil()"><script><rect/></script><foreignObject>x</foreignObject><use href="https://evil/x" xlink:href="#a"/><rect style="fill:red;color:blue" onclick="evil()"/><text>&bad;&amp;</text></svg>';
  const tree = inspectSvgTree(input);
  expect(tree?.removed).toBe(inspectSvg(input)?.removed);
  expect(tree?.removed).toBeGreaterThan(0);
  expect(tree?.root.children).toEqual([
    { name: 'use', attributes: { href: '#a' }, children: [] },
    { name: 'rect', attributes: { style: 'fill:red' }, children: [] },
    { name: 'text', attributes: {}, children: ['&'] },
  ]);
});

it('NFR-SEC-001: reference aliases retain the first safe attribute and count later aliases', () => {
  const input = '<svg><use xlink:href="#a" href="#b"/></svg>';
  expect(inspectSvgTree(input)).toEqual({
    root: { name: 'svg', attributes: {}, children: [{ name: 'use', attributes: { href: '#a' }, children: [] }] },
    removed: 1,
  });
});

it('FR-LIB-004 NFR-SEC-001: syntax inspection preserves unresolved local references for subsequent semantic validation', () => {
  expect(inspectSvgTree('<svg><use href="#missing"/></svg>')?.root.children).toEqual([{ name: 'use', attributes: { href: '#missing' }, children: [] }]);
});

it('NFR-SEC-001: tree inspection keeps root selection, input limits and depth bounds', () => {
  expect(inspectSvgTree('')).toBeUndefined();
  expect(inspectSvgTree('<rect/>')).toBeUndefined();
  expect(inspectSvgTree(`<svg>${' '.repeat(MAX_SVG_CHARS)}</svg>`)).toBeUndefined();
  expect(inspectSvgTree('<rect/><svg/><svg/>')).toEqual({ root: { name: 'svg', attributes: {}, children: [] }, removed: 2 });
  const input = `<svg>${'<g>'.repeat(100)}<rect/>${'</g>'.repeat(100)}</svg>`;
  const tree = inspectSvgTree(input);
  expect(tree?.removed).toBe(inspectSvg(input)?.removed);
  expect(tree?.removed).toBeGreaterThan(0);
  expect(JSON.stringify(tree)).not.toContain('rect');
});

it('NFR-SEC-001: node overflow cannot expose the unread tail in tree data', () => {
  const tree = inspectSvgTree(`<svg>${'<rect/>'.repeat(20_005)}<text>unread</text></svg>`);
  expect(tree?.root.children.length).toBeLessThanOrEqual(20_000);
  expect(tree?.removed).toBeGreaterThan(0);
  expect(JSON.stringify(tree)).not.toContain('unread');
});
