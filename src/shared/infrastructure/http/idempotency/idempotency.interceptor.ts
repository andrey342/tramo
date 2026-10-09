import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Response } from 'express';
import { Redis } from 'ioredis';
import { catchError, concatMap, from, type Observable, of, throwError } from 'rxjs';

import { REDIS_CLIENT } from '../../redis';
import { principalOf, type RequestWithPrincipal } from '../principal';
import { ProblemException } from '../problem-details';

import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT,
  IDEMPOTENT_REPLAYED_HEADER,
} from './idempotent.decorator';

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
// Long enough for any request to finish; short enough that a crashed request does not block
// retries for a day.
const IN_PROGRESS_TTL_MS = 60 * 1000;
// Response headers a client may rely on after a create; replayed along with status and body.
const REPLAYED_HEADERS = ['location', 'content-location', 'etag'] as const;

type IdempotencyRecord =
  | { readonly state: 'in_progress'; readonly fingerprint: string }
  | {
      readonly state: 'completed';
      readonly fingerprint: string;
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: unknown;
    };

// Scope is (principal, key); the fingerprint (method, route, body) decides between "replay" and
// "key reused for a different request".
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (!this.reflector.get<boolean | undefined>(IDEMPOTENT, context.getHandler())) {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithPrincipal>();
    const response = http.getResponse<Response>();

    const key = this.readKey(request);
    const storageKey = this.storageKey(request, key);
    const fingerprint = this.fingerprint(request);

    const existing = await this.read(storageKey);
    if (existing) {
      return this.answerFromExisting(existing, fingerprint, response);
    }
    const locked = await this.redis.set(
      storageKey,
      JSON.stringify({ state: 'in_progress', fingerprint } satisfies IdempotencyRecord),
      'PX',
      IN_PROGRESS_TTL_MS,
      'NX',
    );
    if (locked !== 'OK') {
      throw inProgress();
    }

    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        const record: IdempotencyRecord = {
          state: 'completed',
          fingerprint,
          status: response.statusCode,
          headers: replayableHeaders(response),
          body: body ?? null,
        };
        await this.redis.set(storageKey, JSON.stringify(record), 'PX', COMPLETED_TTL_MS);
        return body;
      }),
      // A failed request leaves nothing behind, so the client can retry with the same key.
      catchError((error: unknown) =>
        from(this.redis.del(storageKey)).pipe(concatMap(() => throwError(() => error))),
      ),
    );
  }

  private readKey(request: RequestWithPrincipal): string {
    const key = request.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined) {
      throw new ProblemException(
        HttpStatus.BAD_REQUEST,
        'idempotency_key_missing',
        `This endpoint requires an ${IDEMPOTENCY_KEY_HEADER} header.`,
      );
    }
    if (!KEY_PATTERN.test(key)) {
      throw new ProblemException(
        HttpStatus.BAD_REQUEST,
        'idempotency_key_invalid',
        `${IDEMPOTENCY_KEY_HEADER} must be 1 to 255 visible ASCII characters.`,
      );
    }
    return key;
  }

  private answerFromExisting(
    existing: IdempotencyRecord,
    fingerprint: string,
    response: Response,
  ): Observable<unknown> {
    if (existing.fingerprint !== fingerprint) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'idempotency_key_reused',
        `This ${IDEMPOTENCY_KEY_HEADER} was already used for a different request.`,
      );
    }
    if (existing.state === 'in_progress') {
      throw inProgress();
    }
    response.status(existing.status);
    for (const [name, value] of Object.entries(existing.headers)) {
      response.setHeader(name, value);
    }
    response.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return of(existing.body);
  }

  private async read(storageKey: string): Promise<IdempotencyRecord | null> {
    const raw = await this.redis.get(storageKey);
    return raw === null ? null : (JSON.parse(raw) as IdempotencyRecord);
  }

  private storageKey(request: RequestWithPrincipal, key: string): string {
    const principal = principalOf(request);
    const scope =
      principal.kind === 'user'
        ? `user:${principal.userId}`
        : principal.kind === 'api_key'
          ? `api_key:${principal.apiKeyId}`
          : 'anonymous';
    return `tramo:idempotency:${sha256(`${scope}\n${key}`)}`;
  }

  private fingerprint(request: RequestWithPrincipal): string {
    const path = request.originalUrl.split('?', 1)[0] ?? '';
    return sha256(`${request.method} ${path}\n${stableStringify(request.body)}`);
  }
}

function replayableHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of REPLAYED_HEADERS) {
    const value = response.getHeader(name);
    if (typeof value === 'string') {
      headers[name] = value;
    }
  }
  return headers;
}

function inProgress(): ProblemException {
  return new ProblemException(
    HttpStatus.CONFLICT,
    'idempotency_request_in_progress',
    'A request with this key is still being processed. Retry later.',
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Key order must not change the fingerprint: {"a":1,"b":2} and {"b":2,"a":1} are the same body.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
