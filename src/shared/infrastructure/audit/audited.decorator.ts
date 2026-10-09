import { SetMetadata } from '@nestjs/common';

export const AUDITED = Symbol('AUDITED');

export interface AuditedOptions {
  // `<resource>.<verb>`, e.g. `center.create`, `application.decide`.
  readonly action: string;
  readonly resource: string;
  // Route parameter holding the resource id; when absent, `id` of the response body is used.
  readonly resourceIdParam?: string;
}

// For commands run by operations and admins: every call is recorded in shared.audit_log with the
// caller, the outcome and, when the handler describes them, the changes it made.
export const Audited = (options: AuditedOptions): MethodDecorator => SetMetadata(AUDITED, options);
