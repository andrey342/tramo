import { AggregateRoot, InvalidStateTransitionError, type JsonValue } from '@shared/domain';

import { WebhookDeliveryInProgressError } from '../errors/notifications-errors';
import { NotificationsEvents, type WebhookDeliveredPayload } from '../events/notifications-events';

import { type WebhookEvent } from './webhook-subscription';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

const MAX_ERROR_LENGTH = 100;
// A round with no attempt for this long has lost its job (dead-lettered after an outage, removed
// by hand): it may be redelivered although it never ended. A job of the old round that still
// runs posts nothing once the round has moved on.
export const STALE_ROUND_MS = 15 * 60 * 1000;

// One POST to the center's endpoint. `error` is a category (`http_503`, `timeout`,
// `connection_failed`...), never the text of the failure.
export interface DeliveryAttempt {
  readonly round: number;
  readonly at: Date;
  readonly statusCode: number | null;
  readonly error: string | null;
}

// What an attempt got: the status of the answer, or why there was none.
export type AttemptResult =
  { readonly statusCode: number } | { readonly statusCode: null; readonly error: string };

export type AttemptOutcome = 'delivered' | 'retry' | 'failed' | 'ignored';

export interface WebhookDeliveryProps {
  readonly centerId: string;
  // The Tramo event it reports; one delivery per center and event.
  readonly eventId: string;
  readonly event: WebhookEvent;
  readonly data: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: Date;
  readonly status: DeliveryStatus;
  // 1 for the first delivery, +1 for each redelivery.
  readonly round: number;
  readonly roundStartedAt: Date;
  readonly attempts: readonly DeliveryAttempt[];
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
}

// An event told to a training center by webhook: posted, retried with backoff by its job, and
// redelivered on request once a round has ended (or lost its job).
//
//   pending → delivered (a 2xx) | failed (the last attempt of the round failed)
//   delivered | failed | pending, stale → pending (redelivery, a new round)
export class WebhookDelivery extends AggregateRoot {
  private constructor(
    id: string,
    private props: WebhookDeliveryProps,
  ) {
    super(id);
  }

  static request(input: {
    id: string;
    centerId: string;
    eventId: string;
    event: WebhookEvent;
    data: Readonly<Record<string, JsonValue>>;
    occurredAt: Date;
    now: Date;
  }): WebhookDelivery {
    const delivery = new WebhookDelivery(input.id, {
      centerId: input.centerId,
      eventId: input.eventId,
      event: input.event,
      data: input.data,
      occurredAt: input.occurredAt,
      status: 'pending',
      round: 1,
      roundStartedAt: input.now,
      attempts: [],
      deliveredAt: null,
      createdAt: input.now,
    });
    delivery.recordRequested(input.now);
    return delivery;
  }

  static reconstitute(id: string, props: WebhookDeliveryProps): WebhookDelivery {
    return new WebhookDelivery(id, props);
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get eventId(): string {
    return this.props.eventId;
  }

  get event(): WebhookEvent {
    return this.props.event;
  }

  get data(): Readonly<Record<string, JsonValue>> {
    return this.props.data;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get status(): DeliveryStatus {
    return this.props.status;
  }

  get round(): number {
    return this.props.round;
  }

  get roundStartedAt(): Date {
    return this.props.roundStartedAt;
  }

  get attempts(): readonly DeliveryAttempt[] {
    return this.props.attempts;
  }

  get deliveredAt(): Date | null {
    return this.props.deliveredAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get lastAttempt(): DeliveryAttempt | null {
    return this.props.attempts.at(-1) ?? null;
  }

  // Whether the job of `round` still has something to post: a finished round, or a job of an
  // earlier round redelivered since, posts nothing.
  awaits(round: number): boolean {
    return this.props.status === 'pending' && this.props.round === round;
  }

  // The result of one attempt of `round`: a 2xx delivers it; anything else is retried, and on the
  // round's last attempt fails it. Ignored when the round is over. Idempotent.
  recordAttempt(
    round: number,
    result: AttemptResult,
    lastAttempt: boolean,
    now: Date,
  ): AttemptOutcome {
    if (!this.awaits(round)) {
      return 'ignored';
    }
    const { statusCode } = result;
    const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;
    const error = delivered
      ? null
      : statusCode === null
        ? result.error.slice(0, MAX_ERROR_LENGTH)
        : `http_${String(statusCode)}`;
    this.props = {
      ...this.props,
      attempts: [...this.props.attempts, { round, at: now, statusCode, error }],
    };
    if (delivered) {
      this.props = { ...this.props, status: 'delivered', deliveredAt: now };
      this.record({
        eventType: NotificationsEvents.WebhookDelivered,
        aggregateType: 'WebhookDelivery',
        aggregateId: this.id,
        occurredAt: now,
        payload: this.reference(),
      });
      return 'delivered';
    }
    if (lastAttempt) {
      this.fail(now);
      return 'failed';
    }
    return 'retry';
  }

  // The round's job ran out of attempts without one being recorded (it failed before posting).
  // Idempotent.
  giveUp(round: number, error: string, now: Date): void {
    if (!this.awaits(round)) {
      return;
    }
    this.props = {
      ...this.props,
      attempts: [
        ...this.props.attempts,
        { round, at: now, statusCode: null, error: error.slice(0, MAX_ERROR_LENGTH) },
      ],
    };
    this.fail(now);
  }

  // Posted again, as a new round: after a failure (the endpoint is back), after a delivery the
  // center lost, or for a round whose job was lost (no attempt for STALE_ROUND_MS).
  redeliver(now: Date): number {
    if (this.props.status === 'pending' && !this.isStale(now)) {
      throw new WebhookDeliveryInProgressError(this.id);
    }
    this.props = {
      ...this.props,
      status: 'pending',
      round: this.props.round + 1,
      roundStartedAt: now,
      deliveredAt: null,
    };
    this.recordRequested(now);
    return this.props.round;
  }

  // A delivery whose center removed its webhook in the meantime is not posted.
  cancel(now: Date): void {
    if (this.props.status !== 'pending') {
      throw new InvalidStateTransitionError('WebhookDelivery', this.props.status, 'failed');
    }
    this.giveUp(this.props.round, 'webhook_removed', now);
  }

  private isStale(now: Date): boolean {
    const lastActivity = Math.max(
      this.props.roundStartedAt.getTime(),
      this.lastAttempt?.at.getTime() ?? 0,
    );
    return now.getTime() - lastActivity >= STALE_ROUND_MS;
  }

  private fail(now: Date): void {
    this.props = { ...this.props, status: 'failed' };
    this.record({
      eventType: NotificationsEvents.WebhookDeliveryFailed,
      aggregateType: 'WebhookDelivery',
      aggregateId: this.id,
      occurredAt: now,
      payload: { ...this.reference(), lastError: this.lastAttempt?.error ?? 'unknown' },
    });
  }

  private reference(): WebhookDeliveredPayload {
    return {
      deliveryId: this.id,
      centerId: this.props.centerId,
      event: this.props.event,
      round: this.props.round,
    };
  }

  private recordRequested(now: Date): void {
    this.record({
      eventType: NotificationsEvents.WebhookDeliveryRequested,
      aggregateType: 'WebhookDelivery',
      aggregateId: this.id,
      occurredAt: now,
      payload: this.reference(),
    });
  }
}
