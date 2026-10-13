import { collectDefaultMetrics, Registry } from 'prom-client';

export const METRICS_REGISTRY = Symbol('METRICS_REGISTRY');

// One registry per process (not prom-client's global one), so tests that build several apps do
// not register the same metric twice.
export function createMetricsRegistry(): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'tramo_' });
  return registry;
}
