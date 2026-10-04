// Builds what the desktop app bundles: the web app (web/dist) and the single-file simulator (index.html).
// Run by `tauri dev` / `tauri build` (beforeDevCommand / beforeBuildCommand), or by hand: node desktop/prepare-assets.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win });
  if (r.error) return false;
  if (r.status !== 0) process.exit(r.status ?? 1);
  return true;
}
if (!existsSync(join(root, 'web', 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund'], join(root, 'web'));
run('npm', ['run', 'build'], join(root, 'web'));
// python3 on mac/Linux; Windows installs often only have `python` or the `py` launcher
const py = ['python3', 'python', 'py'].find((p) => spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0);
if (!py) {
  console.error('prepare-assets: no Python found (python3 / python / py) to run build.py');
  process.exit(1);
}
run(py, ['build.py'], root);
