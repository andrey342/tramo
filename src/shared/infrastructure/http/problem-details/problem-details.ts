import { STATUS_CODES } from 'node:http';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

// RFC 9457 document. `code` and `requestId` are extension members: `code` gives clients a stable
// machine-readable identifier, `requestId` lets support correlate a response with the logs.
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly errors?: readonly FieldError[];
}

// Problem types are URNs on purpose: they identify the problem without implying a documentation
// page that clients would try to fetch. The catalogue lives in the OpenAPI document.
export function problemType(slug: string): string {
  return `urn:tramo:problem:${slug}`;
}

// The status phrase in sentence case ("Not found", "Too many requests"), like the titles of the
// domain's problems, so a 404 reads the same whether a route or an entity is missing.
export function statusTitle(status: number): string {
  const phrase = STATUS_CODES[status] ?? 'Error';
  return phrase.charAt(0) + phrase.slice(1).toLowerCase();
}

// Errors without a domain code still get one, derived from the status ("Not found" ->
// "not_found"), so clients can always branch on `code`.
export function statusCode(status: number): string {
  return statusTitle(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
