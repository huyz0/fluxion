import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Copy tracked working bytes, remapping workspace dependencies into the copy. No build outputs are shared. */
export function compilerSnapshot(repo, target) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') || key === 'GIT_EXEC_PATH'));
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: repo, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(`Cannot inventory tracked source: ${listed.stderr}`);
  mkdirSync(target, { recursive: true });
  const inventory = {};
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (!existsSync(join(repo, file))) throw new Error(`Missing tracked file: ${file}`);
    mkdirSync(dirname(join(target, file)), { recursive: true });
    cpSync(join(repo, file), join(target, file));
    inventory[file] = createHash('sha256')
      .update(readFileSync(join(target, file)))
      .digest('hex');
  }
  const workspaces = JSON.parse(readFileSync(join(repo, 'tools/gen/workspaces.json'), 'utf8')).workspaces;
  const directories = outputDirectories(target, workspaces);
  writeFileSync(`${target}-source-inventory.json`, `${JSON.stringify(inventory, null, 2)}\n`);
  const dirs = new Map(workspaces.map(({ name, dir }) => [name, dir]));
  symlinkSync(join(repo, 'node_modules'), join(target, 'node_modules'), 'junction');
  for (const { dir } of workspaces) linkWorkspace(repo, target, dir, dirs);
  return directories;
}

function outputDirectories(target, workspaces) {
  const directories = [...workspaces.map(({ dir }) => dir), 'e2e'];
  const rootConfig = JSON.parse(readFileSync(join(target, 'tsconfig.json'), 'utf8'));
  const references = rootConfig.references.map(({ path }) => path.replace(/^\.\//, '')).sort();
  if (JSON.stringify(references) !== JSON.stringify([...directories].sort()) || rootConfig.files.length !== 0)
    throw new Error('Solution inventory changed; qualify all project outputs before comparing');
  for (const dir of directories) {
    const config = JSON.parse(readFileSync(join(target, dir, 'tsconfig.json'), 'utf8'));
    if (config.compilerOptions.outDir !== '.tsbuild') throw new Error(`Unsupported output directory in ${dir}; update complete emission inventory`);
  }
  return directories;
}

function linkWorkspace(repo, target, dir, dirs) {
  const install = join(repo, dir, 'node_modules');
  if (!existsSync(install)) return;
  const copied = join(target, dir, 'node_modules');
  mkdirSync(join(copied, '@fluxion'), { recursive: true });
  for (const name of readdirSync(install).filter((name) => name !== '@fluxion')) symlinkSync(join(install, name), join(copied, name), 'junction');
  if (!existsSync(join(install, '@fluxion'))) return;
  for (const name of readdirSync(join(install, '@fluxion'))) {
    const local = dirs.get(`@fluxion/${name}`);
    if (!local) throw new Error(`Unmapped workspace dependency: @fluxion/${name}`);
    symlinkSync(resolve(target, local), join(copied, '@fluxion', name), 'junction');
  }
}
