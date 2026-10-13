// The BullMQ connection waits for Redis to come back instead of failing (redis-connection.ts), so
// a call made while Redis is down hangs. A request that only reads or adds a job gives up after
// this long and answers without it; the command itself may still reach Redis once it is back.
export const QUEUE_CALL_TIMEOUT_MS = 2_000;

export class QueueUnreachableError extends Error {
  constructor(timeoutMs: number) {
    super(`The job queue did not answer within ${String(timeoutMs)} ms`);
    this.name = 'QueueUnreachableError';
  }
}

// Resolves with the call, or rejects with QueueUnreachableError when it takes longer than
// `timeoutMs`; a call that fails on its own keeps its error.
export async function withinQueueTimeout<T>(
  call: Promise<T>,
  timeoutMs: number = QUEUE_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new QueueUnreachableError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
