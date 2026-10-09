import { type RedisOptions } from 'bullmq';

// Workers need `maxRetriesPerRequest: null` so a Redis restart pauses processing instead of
// failing every in-flight command.
export function bullConnection(url: string): RedisOptions {
  return { url, maxRetriesPerRequest: null };
}
