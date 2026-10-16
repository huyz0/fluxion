// Resources (FR-MCP-002, ADR-0038): the authoring guide, the schemas, the catalog and the examples, built from the same sources as
// llms.txt (the cheat sheet, the grammar and patch schemas, `DSL_CODES`, the catalog) so they cannot drift from the code.
import { catalogText, hostRegistries } from '@fluxion/cli/ops';
import { CHEAT_SHEET, DSL_CODES, fluxScriptJsonSchema, patchJsonSchema } from '@fluxion/dsl';
import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EXAMPLES } from './examples.js';

/** The URIs of the fixed resources and the template of the examples. */
export const RESOURCE_URIS = {
  guide: 'fluxion://guide/authoring',
  diagnostics: 'fluxion://guide/diagnostics',
  fluxscriptSchema: 'fluxion://schema/fluxscript',
  patchSchema: 'fluxion://schema/patch',
  catalog: 'fluxion://catalog',
  examples: 'fluxion://examples/{name}',
} as const;

/** The FluxScript diagnostic codes as a markdown table. */
export function diagnosticsGuide(): string {
  const rows = Object.entries(DSL_CODES).map(([code, e]) => `| \`${code}\` | ${e.severity} | ${e.description.replaceAll('|', '/')} |`);
  return `# FluxScript diagnostics\n\n| Code | Severity | When |\n|---|---|---|\n${rows.join('\n')}\n`;
}

const text = (uri: URL, body: string, mimeType: string) => ({ contents: [{ uri: uri.href, mimeType, text: body }] });

/**
 * Registers the five fixed resources and the examples template on `server`.
 *
 * @internal
 */
export function registerResources(server: McpServer): void {
  const fixed: readonly [string, string, string, string, () => string][] = [
    [
      'authoring-guide',
      RESOURCE_URIS.guide,
      'The FluxScript and AI patch cheat sheet: grammar, rules, one example, the patch ops.',
      'text/markdown',
      () => CHEAT_SHEET,
    ],
    [
      'diagnostics-guide',
      RESOURCE_URIS.diagnostics,
      'Every FluxScript diagnostic code with its severity and when it is reported.',
      'text/markdown',
      diagnosticsGuide,
    ],
    [
      'fluxscript-schema',
      RESOURCE_URIS.fluxscriptSchema,
      'JSON Schema of FluxScript documents.',
      'application/json',
      () => JSON.stringify(fluxScriptJsonSchema(), null, 2),
    ],
    [
      'patch-schema',
      RESOURCE_URIS.patchSchema,
      'JSON Schema of AI patches, as apply_patch takes them.',
      'application/json',
      () => JSON.stringify(patchJsonSchema(), null, 2),
    ],
    [
      'catalog',
      RESOURCE_URIS.catalog,
      'Every shape, layout and marker this host can draw.',
      'text/markdown',
      () => {
        const r = catalogText(hostRegistries().registries, 'md');
        return r.ok ? r.value.text : '';
      },
    ],
  ];
  for (const [name, uri, description, mimeType, body] of fixed) server.registerResource(name, uri, { description, mimeType }, (u) => text(u, body(), mimeType));
  server.registerResource(
    'examples',
    new ResourceTemplate(RESOURCE_URIS.examples, {
      list: () => ({
        resources: Object.keys(EXAMPLES).map((name) => ({ uri: `fluxion://examples/${name}`, name: `example-${name}`, mimeType: 'text/yaml' })),
      }),
    }),
    { description: 'Complete FluxScript examples, by name.', mimeType: 'text/yaml' },
    (uri, variables) => {
      const name = String(variables['name']);
      const example = Object.hasOwn(EXAMPLES, name) ? EXAMPLES[name] : undefined;
      if (example === undefined) throw new Error(`no example "${name}"; the examples are ${Object.keys(EXAMPLES).join(', ')}`);
      return text(uri, example, 'text/yaml');
    },
  );
}
