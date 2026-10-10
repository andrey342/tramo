// Calls the api of the compose stack as a demo user and prints the answer readably.
//   pnpm api:call <METHOD> <path> [json body | @file.json] [--as student|center|ops|admin]
//                 [--anonymous] [--api-key <key>] [--idempotency-key <key>]
// Paths without a prefix go under /api/v1. `{{last.<field>}}` in the path or body is replaced by
// that field of the previous response body (e.g. `GET /applications/{{last.id}}`). Tokens and the
// last response are kept in .local/ so calls can be chained.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEMO_PASSWORD,
  DEMO_USERS,
  isDemoRole,
  type DemoRole,
} from '../../../../scripts/demo-users';
import { env, loadEnv } from '../../../lib/runtime';
import { fail, parseArgs, ROOT } from '../../../lib/scaffold';

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const STATE_DIR = join(ROOT, '.local');
const SESSIONS_FILE = join(STATE_DIR, 'try-endpoint.sessions.json');
const LAST_FILE = join(STATE_DIR, 'try-endpoint.last.json');
const SHOWN_HEADERS = [
  'location',
  'retry-after',
  'idempotent-replayed',
  'x-request-id',
  'www-authenticate',
  'ratelimit-remaining',
];
// Git Bash rewrites arguments that look like POSIX paths (`/me` becomes
// `C:/Program Files/Git/me`) before Node sees them; undo it.
const MSYS_REWRITE = /^[A-Za-z]:\/(?:[^/]+\/)*?Git(\/.*)$/;

loadEnv();
const BASE_URL = env('API_URL', `http://localhost:${env('API_PORT', '3000')}`);
const { positional, flags, options } = parseArgs(process.argv.slice(2));
const [rawMethod, rawPath, rawBody] = positional;
if (!rawMethod || !rawPath) {
  fail(
    'usage: api:call <METHOD> <path> [json body | @file] [--as role] [--anonymous] [--api-key key]',
  );
}
const method = rawMethod.toUpperCase();
const role = options.get('as') ?? 'student';
if (!isDemoRole(role)) {
  fail(`--as must be one of ${Object.keys(DEMO_USERS).join(', ')}`);
}

void main().catch((error: unknown) => {
  const cause = (error as { cause?: { code?: string } }).cause?.code;
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ''}`,
  );
  console.error(`Is the api up at ${BASE_URL}? docker compose ps`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const path = withPrefix(substitute(rawPath ?? ''));
  const body = rawBody === undefined ? undefined : substitute(readBody(rawBody));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) {
    JSON.parse(body); // fail early on invalid JSON
    headers['content-type'] = 'application/json';
  }
  if (method === 'POST') {
    headers['idempotency-key'] = options.get('idempotency-key') ?? randomUUID();
  }
  const apiKey = options.get('api-key');
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (!flags.has('anonymous')) {
    headers.authorization = `Bearer ${await accessToken(role as DemoRole)}`;
  }

  const started = Date.now();
  const response = await fetch(`${BASE_URL}${path}`, { method, headers, body });
  const elapsed = Date.now() - started;
  const text = await response.text();
  const parsed = parseJson(text);

  const who = apiKey ? 'api key' : flags.has('anonymous') ? 'anonymous' : `as ${role}`;
  console.log(
    `${method} ${path} (${who}) -> ${String(response.status)} ${response.statusText} in ${String(elapsed)} ms`,
  );
  if (headers['idempotency-key']) {
    console.log(`  idempotency-key: ${headers['idempotency-key']}`);
  }
  for (const name of SHOWN_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) console.log(`  ${name}: ${value}`);
  }
  console.log();
  if (response.headers.get('content-type')?.includes('application/problem+json')) {
    printProblem(parsed);
  } else if (text.length > 0) {
    console.log(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
  }
  if (response.ok && parsed !== null && typeof parsed === 'object') {
    save(LAST_FILE, parsed);
  }
  if (response.status >= 500) {
    process.exitCode = 1;
  }
}

function withPrefix(rawPath: string): string {
  const path = MSYS_REWRITE.exec(rawPath)?.[1] ?? rawPath;
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return /^\/(api|health|docs|admin)\b/.test(absolute) ? absolute : `/api/v1${absolute}`;
}

function readBody(raw: string): string {
  return raw.startsWith('@') ? readFileSync(join(process.cwd(), raw.slice(1)), 'utf8') : raw;
}

// `{{last.a.b}}` -> field a.b of the last successful response body.
function substitute(text: string): string {
  return text.replace(/\{\{last\.([\w.]+)\}\}/g, (_match, field: string) => {
    const last =
      load<Record<string, unknown>>(LAST_FILE) ??
      fail('no previous response to read {{last.*}} from');
    const value = field
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], last);
    if (value === undefined || value === null) fail(`the previous response has no ${field}`);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

async function accessToken(as: DemoRole): Promise<string> {
  const sessions = load<Partial<Record<DemoRole, Session>>>(SESSIONS_FILE) ?? {};
  const current = sessions[as];
  if (current && current.expiresAt - Date.now() > 30_000) {
    return current.accessToken;
  }
  const renewed = current
    ? await post('/api/v1/auth/refresh', { refreshToken: current.refreshToken })
    : null;
  const session = renewed ?? (await signIn(as));
  sessions[as] = session;
  save(SESSIONS_FILE, sessions);
  return session.accessToken;
}

async function signIn(as: DemoRole): Promise<Session> {
  const credentials = { email: DEMO_USERS[as], password: DEMO_PASSWORD };
  const session = await post('/api/v1/auth/login', credentials);
  if (session) return session;
  // Students can register themselves; the other demo accounts are created by `pnpm seed`.
  if (as === 'student') {
    const registered = await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (registered.ok || registered.status === 409) {
      const retry = await post('/api/v1/auth/login', credentials);
      if (retry) return retry;
    }
  }
  return fail(
    `cannot sign in as ${as} (${DEMO_USERS[as]}): only students register themselves; the other ` +
      'demo accounts exist once `pnpm seed` has run against this database.',
  );
}

async function post(path: string, payload: unknown): Promise<Session | null> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return null;
  const tokens = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}

interface Problem {
  status: number;
  code: string;
  title: string;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: { field: string; message: string }[];
}

function printProblem(body: unknown): void {
  const problem = body as Problem;
  console.log(`  problem    ${problem.code} (${String(problem.status)} ${problem.title})`);
  if (problem.detail) console.log(`  detail     ${problem.detail}`);
  if (problem.instance) console.log(`  instance   ${problem.instance}`);
  if (problem.requestId) console.log(`  requestId  ${problem.requestId}`);
  for (const error of problem.errors ?? []) {
    console.log(`  - ${error.field}: ${error.message}`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// Callers state what they expect the file to hold.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function load<T>(file: string): T | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
}

// The folder holds live tokens and API key secrets, so it ignores itself: whatever clone this
// runs in, `git add -A` cannot pick them up.
function save(file: string, value: unknown): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const ignore = join(STATE_DIR, '.gitignore');
  if (!existsSync(ignore)) {
    writeFileSync(ignore, '*\n');
  }
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
