import { Module } from '@nestjs/common';

import { LendingModule } from './lending.module';

@Module({
  imports: [LendingModule],
  controllers: [],
})
export class LendingHttpModule {}
