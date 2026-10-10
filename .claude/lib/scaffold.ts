// Helpers shared by the skill scripts. Scripts run from the repo root with `pnpm tsx`.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const ROOT = join(__dirname, '..', '..');

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

export function assertKebab(value: string, what: string): void {
  if (!KEBAB.test(value)) {
    fail(`${what} must be kebab-case (e.g. "payouts", "training-centers"), got "${value}".`);
  }
}

export function assertPascal(value: string, what: string): void {
  if (!PASCAL.test(value)) {
    fail(`${what} must be PascalCase (e.g. "SubmitApplication"), got "${value}".`);
  }
}

export const pascal = (kebab: string): string =>
  kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

export const camel = (kebab: string): string => {
  const value = pascal(kebab);
  return value.charAt(0).toLowerCase() + value.slice(1);
};

export const kebabFromPascal = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export const snake = (kebab: string): string => kebab.replace(/-/g, '_');

export const constantCase = (kebab: string): string => snake(kebab).toUpperCase();

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

export function exists(path: string): boolean {
  return existsSync(join(ROOT, path));
}

// Collects every change first, so a scaffold either applies completely or not at all.
export class ChangeSet {
  private readonly files = new Map<string, { content: string; created: boolean }>();

  create(path: string, content: string): void {
    if (exists(path) || this.files.has(path)) {
      fail(`${path} already exists; refusing to overwrite it.`);
    }
    this.files.set(path, { content, created: true });
  }

  // Edits an existing file (or one created earlier in this change set).
  edit(path: string, change: (content: string) => string): void {
    const current = this.files.get(path)?.content ?? read(path);
    this.files.set(path, {
      content: change(current),
      created: this.files.get(path)?.created ?? false,
    });
  }

  apply(dryRun: boolean): string[] {
    const touched: string[] = [];
    for (const [path, { content, created }] of this.files) {
      touched.push(path);
      console.log(`${dryRun ? 'would ' : ''}${created ? 'create' : 'update'} ${path}`);
      if (!dryRun) {
        mkdirSync(dirname(join(ROOT, path)), { recursive: true });
        writeFileSync(join(ROOT, path), content);
      }
    }
    return touched;
  }
}

// Anchors fail loudly when missing: a template that no longer matches the code must be fixed,
// not silently skipped.
function missingAnchor(anchor: RegExp, file: string): never {
  fail(`could not find ${String(anchor)} in ${file}; update the scaffold to match the code.`);
}

// Inserts `addition` right after the line holding the last match of `anchor` (a global regex).
export function insertAfterLast(
  content: string,
  anchor: RegExp,
  addition: string,
  file: string,
): string {
  const last = [...content.matchAll(anchor)].at(-1) ?? missingAnchor(anchor, file);
  const lineEnd = content.indexOf('\n', last.index + last[0].length);
  const at = lineEnd === -1 ? content.length : lineEnd + 1;
  return content.slice(0, at) + addition + content.slice(at);
}

// Appends `item` to the array literal that starts right after `opener` (e.g. /providers: \[/).
// Prettier reflows the result afterwards.
export function appendToArray(content: string, opener: RegExp, item: string, file: string): string {
  const match = opener.exec(content) ?? missingAnchor(opener, file);
  const start = match.index + match[0].length;
  let depth = 1;
  let end = start;
  for (; end < content.length && depth > 0; end += 1) {
    const char = content[end];
    if (char === '[' || char === '(' || char === '{') depth += 1;
    if (char === ']' || char === ')' || char === '}') depth -= 1;
  }
  const close = end - 1;
  const body = content.slice(start, close).trimEnd();
  const separator = body.length === 0 || body.endsWith(',') ? '' : ',';
  return `${content.slice(0, start)}${body}${separator}${body.length === 0 ? '' : ' '}${item},${content.slice(close)}`;
}

// Adds an import line after the last import of the file.
export function addImport(content: string, line: string): string {
  if (content.includes(line)) {
    return content;
  }
  const imports = [...content.matchAll(/^import [^;]+;\n/gm)];
  const last = imports.at(-1);
  if (!last) {
    return `${line}\n${content}`;
  }
  const at = last.index + last[0].length;
  return content.slice(0, at) + line + '\n' + content.slice(at);
}

// Formats and lints what a scaffold wrote, so its output looks hand-written.
export function tidy(paths: readonly string[]): void {
  const files = paths.filter((path) => /\.(ts|js|cjs|mjs|json|md|sql|yml)$/.test(path));
  const code = files.filter((path) => path.endsWith('.ts'));
  const formattable = files.filter((path) => !path.endsWith('.sql'));
  if (code.length > 0) {
    run('pnpm', ['exec', 'eslint', '--fix', ...code], { allowFailure: true });
  }
  if (formattable.length > 0) {
    run('pnpm', ['exec', 'prettier', '--write', '--log-level', 'warn', ...formattable]);
  }
}

export function run(
  command: string,
  args: readonly string[],
  options: { allowFailure?: boolean } = {},
): boolean {
  try {
    // One quoted command line: pnpm is a .cmd shim on Windows, which only runs through a shell.
    const line = [command, ...args].map((part) =>
      /^[\w.:/@=-]+$/.test(part) ? part : JSON.stringify(part),
    );
    execSync(line.join(' '), { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch (error) {
    if (options.allowFailure) {
      return false;
    }
    throw error;
  }
}

export function relativeToRoot(path: string): string {
  return relative(ROOT, path).replace(/\\/g, '/');
}

export function parseArgs(argv: readonly string[]): {
  positional: string[];
  flags: Set<string>;
  options: Map<string, string>;
} {
  const positional: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
      const next = argv[index + 1];
      if (inline !== undefined) {
        options.set(name, inline);
      } else if (next !== undefined && !next.startsWith('--') && VALUE_OPTIONS.has(name)) {
        options.set(name, next);
        index += 1;
      } else {
        flags.add(name);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, options };
}

// Options that take a value; anything else after `--` is a boolean flag.
const VALUE_OPTIONS = new Set([
  'as',
  'token',
  'limit',
  'responsibility',
  'repository',
  'api-key',
  'idempotency-key',
]);

// Migration file stamp `YYYYMMDDHHMM` and the matching class-name timestamp (ms, UTC).
export function migrationStamp(now = new Date()): { file: string; ms: number } {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const file =
    String(now.getUTCFullYear()) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes());
  const ms = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
  );
  return { file, ms };
}
