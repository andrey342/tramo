import { Controller, Get, Res, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  type HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { type Response } from 'express';

import { Public } from '../http/access.decorators';

import { RedisHealthIndicator } from './redis.health';

const CHECK_TIMEOUT_MS = 1500;

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  // Liveness only says the event loop answers; restarting on a dependency outage would not help.
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  // A failing check is an expected outcome, not an error: answer 503 with Terminus' own body so
  // the caller sees which dependency is down, instead of a generic problem document.
  @Get('ready')
  @HealthCheck()
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        () => this.db.pingCheck('database').withTimeout(CHECK_TIMEOUT_MS),
        () => this.redis.ping('redis', CHECK_TIMEOUT_MS),
      ]);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        res.status(error.getStatus());
        return error.getResponse() as HealthCheckResult;
      }
      throw error;
    }
  }
}
