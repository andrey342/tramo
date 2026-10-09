import { Global, Module } from '@nestjs/common';

import { AUDIT_TRAIL } from '@shared/application';

import { ClsAuditTrail } from './cls-audit-trail';

@Global()
@Module({
  providers: [ClsAuditTrail, { provide: AUDIT_TRAIL, useExisting: ClsAuditTrail }],
  exports: [AUDIT_TRAIL, ClsAuditTrail],
})
export class AuditModule {}
