import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { type AuditChanges, type AuditTrail } from '@shared/application';

const CHANGES_KEY = 'audit.changes';

type Collected = Record<string, AuditChanges[string]>;

// Changes are collected in the request context and written by the audit interceptor when the
// request ends, so handlers do not depend on HTTP or on the audit table. A unit of work runs in a
// copy of the context, so values set inside it are gone once it ends: the interceptor opens one
// object before the handler runs, and changes are added to it in place.
@Injectable()
export class ClsAuditTrail implements AuditTrail {
  constructor(private readonly cls: ClsService) {}

  open(): void {
    if (this.cls.isActive()) {
      this.cls.set<Collected>(CHANGES_KEY, {});
    }
  }

  // Only what changed: a field whose value stayed the same (a repeated, idempotent call) is left
  // out, so a call that changed nothing is recorded without changes.
  describeChanges(changes: AuditChanges): void {
    if (!this.cls.isActive()) {
      return;
    }
    const changed = Object.fromEntries(
      Object.entries(changes).filter(
        ([, change]) => JSON.stringify(change.before) !== JSON.stringify(change.after),
      ),
    );
    const current = this.cls.get<Collected | undefined>(CHANGES_KEY);
    if (current) {
      Object.assign(current, changed);
    } else {
      this.cls.set<Collected>(CHANGES_KEY, changed);
    }
  }

  collected(): AuditChanges | undefined {
    const current = this.cls.isActive()
      ? this.cls.get<Collected | undefined>(CHANGES_KEY)
      : undefined;
    return current && Object.keys(current).length > 0 ? current : undefined;
  }
}
