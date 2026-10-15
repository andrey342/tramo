// For an effect that crosses queue workers. A worker's Redis connection can be reset in the middle
// of a job (Docker Desktop's port forwarding does it on Windows): ioredis reconnects, and BullMQ
// hands a job whose lock lapsed to a worker again at its next stalled-job check, up to a minute
// later with its defaults (30 s lock, 30 s check). A passing run never waits that long.
export const ACROSS_WORKERS = { timeoutMs: 90_000 } as const;

// Polls until the assertion stops throwing. For effects that happen asynchronously in queue
// workers; fails with the last assertion error once the timeout expires.
export async function eventually(
  assertion: () => void | Promise<void>,
  { timeoutMs = 10_000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
