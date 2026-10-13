import { createHash, timingSafeEqual } from 'node:crypto';

import { Controller, Get, Headers, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type Response } from 'express';
import { type Registry } from 'prom-client';

import { APP_CONFIG, type AppConfig } from '../config';
import { Public } from '../http/access.decorators';

import { METRICS_REGISTRY } from './metrics-registry';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

// Prometheus scrapes with `Authorization: Bearer <METRICS_TOKEN>`. Without a configured token the
// route answers 404, as if it did not exist; a wrong one gets 401 with no body.
@ApiExcludeController()
@SkipThrottle()
@Public()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  private readonly expected: Buffer | undefined;

  constructor(
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.expected = config.metrics.token === undefined ? undefined : digest(config.metrics.token);
  }

  @Get()
  async scrape(
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.expected) {
      res.status(404).end();
      return;
    }
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!timingSafeEqual(digest(supplied), this.expected)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="tramo-metrics"');
      res.status(401).end();
      return;
    }
    res.setHeader('Content-Type', this.registry.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await this.registry.metrics());
  }
}
