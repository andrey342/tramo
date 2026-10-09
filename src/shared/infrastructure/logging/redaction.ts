// Paths are matched by pino's fast-redact. Wildcards cover one level of nesting, which is enough
// for request bodies and the structured objects we log from handlers and jobs.
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.nationalId',
  '*.iban',
  '*.email',
] as const;

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
