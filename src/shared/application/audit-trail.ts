import { type JsonValue } from '@shared/domain';

export const AUDIT_TRAIL = Symbol('AUDIT_TRAIL');

export type AuditChanges = Readonly<
  Record<string, { readonly before: JsonValue; readonly after: JsonValue }>
>;

// Commands run by operations or admins are audited by the HTTP layer (who, what, which resource,
// outcome). A handler that changes state adds what changed so the entry shows before and after,
// summarised to the fields that matter.
export interface AuditTrail {
  describeChanges(changes: AuditChanges): void;
}
