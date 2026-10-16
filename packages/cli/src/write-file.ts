// Output files are written to a temporary name and renamed, so a command never leaves a partial output (ADR-0036).
import { rename, unlink, writeFile } from 'node:fs/promises';
import { io, type Outcome } from './command.js';

/** Writes `text` to `path` atomically; the IO outcome when it cannot. */
export async function writeText(path: string, text: string): Promise<Outcome | undefined> {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, path);
    return undefined;
  } catch (e) {
    await unlink(temp).catch(() => undefined);
    return io(`cannot write ${path}: ${e instanceof Error ? e.message : String(e)}`, ['argv']);
  }
}
