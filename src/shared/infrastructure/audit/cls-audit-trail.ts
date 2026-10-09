import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { type AuditChanges, type AuditTrail } from '@shared/application';

const CHANGES_KEY = 'audit.changes';

// Changes are collected in the request context and written by the audit interceptor when the
// request ends, so handlers do not depend on HTTP or on the audit table.
@Injectable()
export class ClsAuditTrail implements AuditTrail {
  constructor(private readonly cls: ClsService) {}

  describeChanges(changes: AuditChanges): void {
    if (!this.cls.isActive()) {
      return;
    }
    const current = this.cls.get<AuditChanges | undefined>(CHANGES_KEY) ?? {};
    this.cls.set(CHANGES_KEY, { ...current, ...changes });
  }

  collected(): AuditChanges | undefined {
    return this.cls.isActive() ? this.cls.get<AuditChanges | undefined>(CHANGES_KEY) : undefined;
  }
}
