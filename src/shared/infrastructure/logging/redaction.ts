// Fields never written to logs in clear, at the top of a log object and up to two levels down
// (pino's fast-redact matches one level per wildcard).
const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'secret',
  'secretHash',
  'key',
  'apiKey',
  'authorization',
  'nationalId',
  'iban',
  'email',
] as const;

export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) {
    return '[REDACTED]';
  }
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) {
    return '[REDACTED]';
  }
  return `***${value.slice(-visible)}`;
}

export function censor(value: unknown, path: string[]): unknown {
  if (typeof value !== 'string') {
    return '[REDACTED]';
  }
  const key = path.at(-1);
  if (key === 'email') {
    return maskEmail(value);
  }
  if (key === 'iban' || key === 'nationalId') {
    return maskTail(value);
  }
  return '[REDACTED]';
}

// Database errors carry the SQL, its bound parameters and the offending row (`detail`, e.g.
// "Key (email)=(ana@example.com) already exists"), which can hold emails, password hashes or
// national ids. Logs keep the kind of failure, not the data.
const ERROR_FIELDS_NOT_LOGGED = new Set([
  'query',
  'parameters',
  'detail',
  'where',
  'internalQuery',
  'driverError',
]);

// Receives the error as pino's standard serializer left it (a plain object).
export function scrubError(err: unknown): unknown {
  if (err === null || typeof err !== 'object') {
    return err;
  }
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(err)) {
    if (ERROR_FIELDS_NOT_LOGGED.has(key)) {
      continue;
    }
    scrubbed[key] = key === 'cause' ? scrubError(value) : value;
  }
  return scrubbed;
}
