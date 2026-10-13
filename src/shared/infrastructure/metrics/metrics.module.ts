import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';

import { BacklogMetrics } from './backlog-metrics';
import { HttpMetrics, HttpMetricsMiddleware } from './http-metrics';
import { createMetricsRegistry, METRICS_REGISTRY } from './metrics-registry';
import { MetricsController } from './metrics.controller';

// Served by the api only: HTTP latency is measured there, and the backlog it reports (queues and
// outbox) is shared by both processes, so one scrape target sees all of it.
@Module({
  controllers: [MetricsController],
  providers: [
    { provide: METRICS_REGISTRY, useFactory: createMetricsRegistry },
    HttpMetrics,
    BacklogMetrics,
  ],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
