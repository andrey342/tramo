import { AggregateRoot, InvalidStateTransitionError, type JsonValue } from '@shared/domain';

import { WebhookDeliveryInProgressError } from '../errors/notifications-errors';
import { NotificationsEvents, type WebhookDeliveredPayload } from '../events/notifications-events';

import { type WebhookEvent } from './webhook-subscription';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

const MAX_ERROR_LENGTH = 300;

// One POST to the center's endpoint.
export interface DeliveryAttempt {
  readonly round: number;
  readonly at: Date;
  readonly statusCode: number | null;
  readonly error: string | null;
}

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
  readonly attempts: readonly DeliveryAttempt[];
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
}

// An event told to a training center by webhook: posted, retried with backoff by its job, and
// redelivered on request once a round has ended.
//
//   pending → delivered (a 2xx) | failed (every attempt of the round failed)
//   delivered | failed → pending (redelivery, a new round)
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

  // The endpoint answered 2xx. Idempotent.
  recordDelivered(round: number, statusCode: number, now: Date): void {
    if (!this.awaits(round)) {
      return;
    }
    this.props = {
      ...this.props,
      status: 'delivered',
      deliveredAt: now,
      attempts: [...this.props.attempts, { round, at: now, statusCode, error: null }],
    };
    this.record({
      eventType: NotificationsEvents.WebhookDelivered,
      aggregateType: 'WebhookDelivery',
      aggregateId: this.id,
      occurredAt: now,
      payload: this.reference(),
    });
  }

  // An attempt failed (a non-2xx answer, a timeout, a refused connection); the job retries it.
  recordFailedAttempt(round: number, statusCode: number | null, error: string, now: Date): void {
    if (!this.awaits(round)) {
      return;
    }
    this.props = {
      ...this.props,
      attempts: [
        ...this.props.attempts,
        { round, at: now, statusCode, error: error.slice(0, MAX_ERROR_LENGTH) },
      ],
    };
  }

  // The last attempt of the round failed. Idempotent.
  giveUp(round: number, now: Date): void {
    if (!this.awaits(round)) {
      return;
    }
    this.props = { ...this.props, status: 'failed' };
    this.record({
      eventType: NotificationsEvents.WebhookDeliveryFailed,
      aggregateType: 'WebhookDelivery',
      aggregateId: this.id,
      occurredAt: now,
      payload: { ...this.reference(), lastError: this.lastAttempt?.error ?? 'unknown' },
    });
  }

  // Posted again, as a new round: after a failure (the endpoint is back), or after a delivery the
  // center lost.
  redeliver(now: Date): number {
    if (this.props.status === 'pending') {
      throw new WebhookDeliveryInProgressError(this.id);
    }
    this.props = { ...this.props, status: 'pending', round: this.props.round + 1 };
    this.recordRequested(now);
    return this.props.round;
  }

  // A delivery whose center removed its webhook in the meantime is not posted.
  cancel(now: Date): void {
    if (this.props.status !== 'pending') {
      throw new InvalidStateTransitionError('WebhookDelivery', this.props.status, 'failed');
    }
    this.props = {
      ...this.props,
      attempts: [
        ...this.props.attempts,
        { round: this.props.round, at: now, statusCode: null, error: 'webhook removed' },
      ],
    };
    this.giveUp(this.props.round, now);
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
