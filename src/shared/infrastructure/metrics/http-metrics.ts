import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { Histogram, type Registry } from 'prom-client';

import { METRICS_REGISTRY } from './metrics-registry';

// Requests that matched no route share one label, so probing random paths cannot grow the series.
export const UNMATCHED_ROUTE = 'unmatched';

// Latency of every request by method, route template and status.
@Injectable()
export class HttpMetrics {
  private readonly duration: Histogram<'method' | 'route' | 'status_code'>;

  constructor(@Inject(METRICS_REGISTRY) registry: Registry) {
    this.duration = new Histogram({
      name: 'tramo_http_request_duration_seconds',
      help: 'Duration of HTTP requests by method, route template and status.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    });
  }

  start(): (labels: Record<'method' | 'route' | 'status_code', string>) => void {
    const end = this.duration.startTimer();
    return (labels) => {
      end(labels);
    };
  }
}

// Times each request from the module middleware to the last byte, so refusals by guards and the
// throttler are counted too. Nest builds middleware apart from providers, hence the split.
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: HttpMetrics) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const end = this.metrics.start();
    res.once('finish', () => {
      end({ method: req.method, route: routeOf(req), status_code: String(res.statusCode) });
    });
    next();
  }
}

// The template the router matched (`/api/v1/centers/:centerId/dashboard`), never the raw path. A
// request no Nest handler took (no route, or a router mounted outside Nest such as Bull Board)
// still carries the route Nest mounts its middleware on, a wildcard, and counts as unmatched.
function routeOf(req: Request): string {
  const route: unknown = req.route;
  if (route && typeof route === 'object' && 'path' in route && typeof route.path === 'string') {
    return route.path.includes('*') ? UNMATCHED_ROUTE : `${req.baseUrl.toLowerCase()}${route.path}`;
  }
  return UNMATCHED_ROUTE;
}
