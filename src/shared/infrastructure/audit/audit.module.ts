import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AUDIT_TRAIL } from '@shared/application';

import { AuditInterceptor } from './audit.interceptor';
import { ClsAuditTrail } from './cls-audit-trail';

@Global()
@Module({
  providers: [
    ClsAuditTrail,
    { provide: AUDIT_TRAIL, useExisting: ClsAuditTrail },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AUDIT_TRAIL],
})
export class AuditModule {}
