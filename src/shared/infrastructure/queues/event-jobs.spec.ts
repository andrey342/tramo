import { EVENT_JOB_OPTIONS, eventJobId } from './event-jobs';

// BullMQ's exponential backoff waits `delay * 2^(n - 1)` before retry n.
const retryWindowMs = (attempts: number, delay: number): number =>
  Array.from({ length: attempts - 1 }, (_, index) => delay * 2 ** index).reduce(
    (sum, wait) => sum + wait,
    0,
  );

describe('event consumer jobs', () => {
  it('should keep retrying a delivery for about twenty minutes before dead-lettering it', () => {
    const { attempts, backoff } = EVENT_JOB_OPTIONS;

    const windowMs = retryWindowMs(attempts, backoff.delay);

    expect(backoff.type).toBe('exponential');
    expect(windowMs).toBe(1_270_000);
    expect(windowMs).toBeGreaterThan(15 * 60_000);
  });

  it('should name a delivery by its event and consumer when it is queued', () => {
    expect(eventJobId('0199-event', 'reporting.funnel')).toBe('0199-event.reporting.funnel');
  });
});
