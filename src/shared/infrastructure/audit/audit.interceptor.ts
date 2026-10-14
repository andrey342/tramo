import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { catchError, concatMap, from, type Observable, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { uuidv7 } from 'uuidv7';

import { principalId } from '@shared/application';
import { CLOCK, type Clock, DomainError } from '@shared/domain';

import { principalOf, type RequestWithPrincipal } from '../http/principal';
import { ProblemException, statusCode, ValidationProblemException } from '../http/problem-details';

import { AUDITED, type AuditedOptions } from './audited.decorator';
import { ClsAuditTrail } from './cls-audit-trail';

type Outcome =
  | { readonly outcome: 'succeeded'; readonly body: unknown }
  | {
      readonly outcome: 'failed';
      readonly error: unknown;
    };

// Written after the request finishes, outside the handler's transaction: the entry records the
// attempt and its outcome even when the command failed and rolled back. A failure to write the
// entry is logged, never turned into a failed request.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly trail: ClsAuditTrail,
    private readonly cls: ClsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(AUDITED, context.getHandler());
    if (!options) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    this.trail.open();
    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        await this.write(options, request, { outcome: 'succeeded', body });
        return body;
      }),
      catchError((error: unknown) =>
        from(this.write(options, request, { outcome: 'failed', error })).pipe(
          concatMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async write(
    options: AuditedOptions,
    request: RequestWithPrincipal,
    result: Outcome,
  ): Promise<void> {
    const principal = principalOf(request);
    const requestId: unknown = this.cls.isActive() ? this.cls.getId() : undefined;
    try {
      await this.dataSource.query(
        `INSERT INTO shared.audit_log
           (id, occurred_at, actor_type, actor_id, action, resource_type, resource_id, outcome,
            error_code, request_id, changes, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          uuidv7(),
          this.clock.now(),
          principal.kind,
          principalId(principal),
          options.action,
          options.resource,
          resourceId(options, request, result),
          result.outcome,
          result.outcome === 'failed' ? auditErrorCode(result.error) : null,
          typeof requestId === 'string' ? requestId : null,
          result.outcome === 'succeeded' ? (this.trail.collected() ?? null) : null,
          { method: request.method, path: request.originalUrl.split('?', 1)[0] },
        ],
      );
    } catch (error) {
      this.logger.error({ err: error, action: options.action }, 'Failed to write audit entry');
    }
  }
}

function resourceId(
  options: AuditedOptions,
  request: RequestWithPrincipal,
  result: Outcome,
): string | null {
  if (options.resourceIsCaller) {
    return principalId(principalOf(request));
  }
  const fromParam = request.params[options.resourceIdParam ?? 'id'];
  if (typeof fromParam === 'string') {
    return fromParam;
  }
  if (result.outcome === 'succeeded' && typeof result.body === 'object' && result.body !== null) {
    const id = (result.body as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

// The code the client was given in its Problem Details, so an audit entry and a support ticket
// name the same failure. Errors the filter renders as 500 keep their class name, which says more
// than "internal_server_error" to whoever reads the log.
export function auditErrorCode(error: unknown): string {
  if (
    error instanceof DomainError ||
    error instanceof ProblemException ||
    error instanceof ValidationProblemException
  ) {
    return error.code;
  }
  if (error instanceof HttpException) {
    return statusCode(error.getStatus());
  }
  return error instanceof Error ? error.name : 'unknown';
}
