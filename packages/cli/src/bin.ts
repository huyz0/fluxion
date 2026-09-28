#!/usr/bin/env node
// The `fluxion` executable (package.json "bin"): runs the command line against the process streams.
import { run } from './main.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
