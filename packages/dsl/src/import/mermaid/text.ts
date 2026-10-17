// The text of a Mermaid mindmap line written `id[text]`, `id(text)`, `id((text))`, `id{{text}}` or as plain text.

/** The text inside the brackets that follow an optional id, else the line unchanged. */
export function bracketText(line: string): string {
  const m = /^[\w-]*(?:\(\(|\{\{|\[|\(|\{)(.*)$/.exec(line);
  return m ? (m[1] ?? line).replace(/[)\]}]+$/, '') : line;
}
