import {
  AggregateRoot,
  type Iban,
  InvalidStateTransitionError,
  InvalidValueError,
  type Percentage,
  type VatNumber,
} from '@shared/domain';

import { InvalidPlatformFeeError } from '../errors/catalog-errors';
import { CatalogEvents } from '../events/catalog-events';

import { type VatCheckResult, type VatValidation } from './vat-check';

export type CenterStatus = 'pending_verification' | 'active' | 'suspended';

export interface TrainingCenterProps {
  readonly name: string;
  readonly vatNumber: VatNumber;
  readonly status: CenterStatus;
  readonly vatValidation: VatValidation | null;
  readonly payoutIban: Iban;
  // Tramo's commission on what it disburses to the center.
  readonly platformFee: Percentage;
  readonly createdAt: Date;
}

export const MAX_PLATFORM_FEE_BPS = 3_000;

// A school or bootcamp whose programs students finance through Tramo. It is registered by an
// admin and becomes active once its VAT number checks out; until then it cannot publish programs
// or receive money. A registry outage never blocks registration: the check is retried later.
export class TrainingCenter extends AggregateRoot {
  private constructor(
    id: string,
    private props: TrainingCenterProps,
  ) {
    super(id);
  }

  static register(input: {
    id: string;
    name: string;
    vatNumber: VatNumber;
    payoutIban: Iban;
    platformFee: Percentage;
    now: Date;
  }): TrainingCenter {
    const center = new TrainingCenter(input.id, {
      name: TrainingCenter.validName(input.name),
      vatNumber: input.vatNumber,
      status: 'pending_verification',
      vatValidation: null,
      payoutIban: input.payoutIban,
      platformFee: TrainingCenter.validFee(input.platformFee),
      createdAt: input.now,
    });
    center.record({
      eventType: CatalogEvents.CenterRegistered,
      aggregateType: 'TrainingCenter',
      aggregateId: center.id,
      occurredAt: input.now,
      payload: {
        centerId: center.id,
        name: center.name,
        country: input.vatNumber.country,
        taxId: input.vatNumber.toString(),
      },
    });
    return center;
  }

  static reconstitute(id: string, props: TrainingCenterProps): TrainingCenter {
    return new TrainingCenter(id, props);
  }

  get name(): string {
    return this.props.name;
  }

  get vatNumber(): VatNumber {
    return this.props.vatNumber;
  }

  get status(): CenterStatus {
    return this.props.status;
  }

  get vatValidation(): VatValidation | null {
    return this.props.vatValidation;
  }

  get payoutIban(): Iban {
    return this.props.payoutIban;
  }

  get platformFee(): Percentage {
    return this.props.platformFee;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get isActive(): boolean {
    return this.props.status === 'active';
  }

  // A valid number activates a center waiting for verification. An invalid one is recorded and
  // leaves the status alone: ops decide what happens to a center already working with Tramo.
  // An unavailable registry only marks a center that was never checked as unverified.
  recordVatCheck(result: VatCheckResult, now: Date): void {
    const previous = this.props.vatValidation;
    if (result.outcome === 'unavailable') {
      if (previous === null || previous.status === 'unverified') {
        this.props = {
          ...this.props,
          vatValidation: {
            status: 'unverified',
            checkedAt: now,
            provider: result.provider,
            registeredName: null,
          },
        };
      }
      return;
    }
    this.props = {
      ...this.props,
      vatValidation: {
        status: result.outcome,
        checkedAt: now,
        provider: result.provider,
        registeredName: result.outcome === 'valid' ? result.registeredName : null,
      },
    };
    if (result.outcome === 'valid' && this.props.status === 'pending_verification') {
      this.activate(now);
    }
  }

  suspend(reason: string, now: Date): void {
    if (this.props.status === 'suspended') {
      throw new InvalidStateTransitionError('TrainingCenter', 'suspended', 'suspended');
    }
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > 500) {
      throw new InvalidValueError('reason', 'A suspension needs a reason of 1 to 500 characters.');
    }
    this.props = { ...this.props, status: 'suspended' };
    this.record({
      eventType: CatalogEvents.CenterSuspended,
      aggregateType: 'TrainingCenter',
      aggregateId: this.id,
      occurredAt: now,
      payload: { centerId: this.id, reason: trimmed },
    });
  }

  // Back to active only with a valid VAT number; otherwise back to waiting for verification.
  reinstate(now: Date): void {
    if (this.props.status !== 'suspended') {
      throw new InvalidStateTransitionError('TrainingCenter', this.props.status, 'active');
    }
    if (this.props.vatValidation?.status === 'valid') {
      this.activate(now);
    } else {
      this.props = { ...this.props, status: 'pending_verification' };
    }
  }

  rename(name: string): void {
    this.props = { ...this.props, name: TrainingCenter.validName(name) };
  }

  changePlatformFee(fee: Percentage): void {
    this.props = { ...this.props, platformFee: TrainingCenter.validFee(fee) };
  }

  changePayoutIban(iban: Iban, now: Date): void {
    if (iban.equals(this.props.payoutIban)) {
      return;
    }
    this.props = { ...this.props, payoutIban: iban };
    this.record({
      eventType: CatalogEvents.CenterPayoutAccountChanged,
      aggregateType: 'TrainingCenter',
      aggregateId: this.id,
      occurredAt: now,
      payload: { centerId: this.id, ibanLastFour: iban.lastFour },
    });
  }

  private activate(now: Date): void {
    this.props = { ...this.props, status: 'active' };
    this.record({
      eventType: CatalogEvents.CenterActivated,
      aggregateType: 'TrainingCenter',
      aggregateId: this.id,
      occurredAt: now,
      payload: { centerId: this.id },
    });
  }

  private static validName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > 200) {
      throw new InvalidValueError('name', 'A center name must be 1 to 200 characters.');
    }
    return name;
  }

  private static validFee(fee: Percentage): Percentage {
    if (fee.basisPoints > MAX_PLATFORM_FEE_BPS) {
      throw new InvalidPlatformFeeError(MAX_PLATFORM_FEE_BPS / 100);
    }
    return fee;
  }
}
