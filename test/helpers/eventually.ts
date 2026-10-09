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
