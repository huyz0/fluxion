// Minimal SPDX licence-expression parser for check-licenses (NFR-LIC-002; M1.15 review r2 F1).
// Precedence OR < AND < WITH, parentheses group. `LICENSE WITH EXCEPTION` counts as LICENSE.
// A string that is not a valid expression (free text such as "GNU GPLv3") throws.

/** Parse into { id } | { op: 'and' | 'or', left, right }. */
export function parseSpdx(text) {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i] ?? '';
  const is = (word) => peek().toLowerCase() === word;
  const group = () => {
    const inner = expr();
    if (tokens[i++] !== ')') throw new Error(`unbalanced parentheses in "${text}"`);
    return inner;
  };
  const licence = (t) => {
    if (!t || /^(and|or|with|\))$/i.test(t)) throw new Error(`unexpected "${t ?? 'end'}" in "${text}"`);
    if (!is('with')) return { id: t };
    const exception = tokens[i + 1];
    if (!exception || exception === '(' || exception === ')') throw new Error(`WITH needs an exception in "${text}"`);
    i += 2;
    return { id: t };
  };
  const factor = () => {
    const t = tokens[i++];
    return t === '(' ? group() : licence(t);
  };
  const binary = (op, operand) => () => {
    let left = operand();
    while (is(op)) {
      i++;
      left = { op, left, right: operand() };
    }
    return left;
  };
  const term = binary('and', factor);
  const expr = binary('or', term);
  const tree = expr();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}" in "${text}"`);
  return tree;
}

/** Whether some choice among the OR alternatives uses only licences for which `ok(id)` holds. */
export function satisfiable(node, ok) {
  if (node.id) return ok(node.id);
  const [l, r] = [satisfiable(node.left, ok), satisfiable(node.right, ok)];
  return node.op === 'or' ? l || r : l && r;
}
