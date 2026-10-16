#!/usr/bin/env node
// The `fluxion-mcp` executable (package.json "bin"): `fluxion-mcp [--root <dir>]... [--http [port]]` serves MCP over stdio, or over HTTP on 127.0.0.1.
import { serveHttp } from './http.js';
import { serveStdio } from './stdio.js';

const roots: string[] = [];
let http: number | undefined;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--root' && args[i + 1] !== undefined) roots.push(args[++i] as string);
  else if (args[i] === '--http') http = /^\d+$/.test(args[i + 1] ?? '') ? Number(args[++i]) : 0;
  else {
    process.stderr.write(`fluxion-mcp: unknown argument ${args[i]}\nusage: fluxion-mcp [--root <dir>]... [--http [port]]\n`);
    process.exit(2);
  }
}
const options = { roots: roots.length > 0 ? roots : [process.cwd()] };
if (http === undefined) await serveStdio(options);
else process.stderr.write(`fluxion-mcp: listening on ${(await serveHttp({ ...options, port: http })).url}\n`);
