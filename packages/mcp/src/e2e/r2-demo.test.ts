import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${REPO}${path}`, 'utf8');

/** The `reply:` lines of the scripted transcript, in order. */
const replies = (): string[] => [...read('examples/r2-ai-deck.transcript.md').matchAll(/^ {3}reply: `(.*)`$/gm)].map((m) => m[1] as string);

describe('the R2 demo over MCP (FR-MCP-001, FR-MCP-002)', () => {
  it('FR-MCP-001: the scripted transcript is what the server replies to the same calls', { timeout: 60_000 }, async () => {
    if (!existsSync(BIN)) throw new Error(`${BIN} is missing: run pnpm run build first`);
    const fluxscript = read('examples/r2-ai-deck.flux.yaml');
    const calls: { readonly name: string; readonly arguments: { readonly [key: string]: unknown } }[] = [
      { name: 'compile_dsl', arguments: { fluxscript } },
      { name: 'create_document', arguments: { fluxscript } },
      { name: 'lint', arguments: { docHandle: 'doc_1' } },
      { name: 'get_document_outline', arguments: { docHandle: 'doc_1' } },
      {
        name: 'apply_patch',
        arguments: {
          docHandle: 'doc_1',
          patch: { flux: 1, ops: [{ op: 'add', screen: 'next', slug: 'step4', node: { shape: 'rounded-rect', label: '4. Tell us what you built' } }] },
        },
      },
      { name: 'lint', arguments: { docHandle: 'doc_1' } },
    ];
    const client = new Client({ name: 'r2-demo', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], stderr: 'pipe' }));
    const seen: string[] = [];
    try {
      for (const call of calls) {
        const reply = await client.callTool(call);
        expect(reply.isError, call.name).not.toBe(true);
        const text = (reply.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
        seen.push(text.split('\n')[0] ?? '');
      }
    } finally {
      await client.close();
    }
    expect(seen).toEqual(replies());
  });
});
