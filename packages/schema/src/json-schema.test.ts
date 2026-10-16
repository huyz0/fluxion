import { describe, expect, it } from 'vitest';
import { documentJsonSchema } from './json-schema.js';

describe('the document JSON Schema (FR-AI-001)', () => {
  it('FR-AI-001: the committed specs/schema/flux-document.schema.json equals the schema generated from the Zod records (drift test)', async () => {
    await expect(`${JSON.stringify(documentJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../../../specs/schema/flux-document.schema.json');
  });

  it('FR-AI-001: the schema requires schemaVersion and records and describes every core element kind', () => {
    const schema = documentJsonSchema() as { required?: string[]; properties?: { [k: string]: unknown } };
    expect(schema.required).toEqual(['schemaVersion', 'records']);
    const text = JSON.stringify(schema);
    for (const kind of ['shape', 'connector', 'group', 'frame', 'text', 'image', 'component']) expect(text).toContain(`"${kind}"`);
  });
});
