import { Global, Injectable, Module } from '@nestjs/common';

import { CLOCK, type Clock } from '@shared/domain';

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
