// PostToolUse hook: formats the file an edit just touched, so generated code lands in the same
// shape as hand-written code. Silent and never blocking: a lint error is left for `pnpm lint`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const PRETTIER = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
const ESLINT = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
const FORMATTED = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);
const LINTED = new Set(['.ts', '.js', '.mjs', '.cjs']);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const file = filePathFrom(input);
  if (!file || !existsSync(file)) return;
  const fromRoot = relative(root, file);
  // Outside the repo, or in folders that are not ours to format.
  if (
    fromRoot.startsWith('..') ||
    isAbsolute(fromRoot) ||
    /^(node_modules|dist|\.local)[\\/]/.test(fromRoot)
  ) {
    return;
  }
  const ext = extname(file);
  const run = (bin, args) =>
    spawnSync(process.execPath, [bin, ...args, file], {
      cwd: root,
      stdio: 'ignore',
      timeout: 30_000,
    });
  if (LINTED.has(ext)) run(ESLINT, ['--fix', '--no-warn-ignored']);
  if (FORMATTED.has(ext)) run(PRETTIER, ['--write', '--ignore-unknown', '--log-level', 'silent']);
});

function filePathFrom(raw) {
  try {
    const payload = JSON.parse(raw);
    const path = payload?.tool_input?.file_path;
    return typeof path === 'string' ? path : undefined;
  } catch {
    return undefined;
  }
}
