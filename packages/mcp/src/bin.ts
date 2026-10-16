#!/usr/bin/env node
// The `fluxion-mcp` executable (package.json "bin"): `fluxion-mcp [--root <dir>]...` serves MCP over stdio.
import { serveStdio } from './stdio.js';

const roots: string[] = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1] !== undefined) roots.push(args[++i] as string);
  else {
    process.stderr.write(`fluxion-mcp: unknown argument ${args[i]}\nusage: fluxion-mcp [--root <dir>]...\n`);
    process.exit(2);
  }
}
await serveStdio({ roots: roots.length > 0 ? roots : [process.cwd()] });
