import { AggregateRoot, type Iban, InvalidStateTransitionError } from '@shared/domain';

import { BillingEvents } from '../events/billing-events';

export type MandateStatus = 'active' | 'revoked';

export interface PaymentMandateProps {
  readonly contractId: string;
  readonly studentId: string;
  readonly iban: Iban;
  // The SEPA mandate reference the bank shows the student with each debit.
  readonly reference: string;
  readonly status: MandateStatus;
  readonly signedAt: Date;
  readonly revokedAt: Date | null;
}

// The student's authorisation to collect a contract's charges from their account by SEPA direct
// debit. One active mandate per contract; signing a new one revokes the old.
export class PaymentMandate extends AggregateRoot {
  private constructor(
    id: string,
    private props: PaymentMandateProps,
  ) {
    super(id);
  }

  static sign(input: {
    id: string;
    contractId: string;
    studentId: string;
    iban: Iban;
    now: Date;
  }): PaymentMandate {
    const reference = `TRAMO-${input.id.replace(/-/g, '').slice(-16).toUpperCase()}`;
    const mandate = new PaymentMandate(input.id, {
      contractId: input.contractId,
      studentId: input.studentId,
      iban: input.iban,
      reference,
      status: 'active',
      signedAt: input.now,
      revokedAt: null,
    });
    mandate.record({
      eventType: BillingEvents.MandateSigned,
      aggregateType: 'PaymentMandate',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        mandateId: input.id,
        contractId: input.contractId,
        studentId: input.studentId,
        mandateReference: reference,
      },
    });
    return mandate;
  }

  static reconstitute(id: string, props: PaymentMandateProps): PaymentMandate {
    return new PaymentMandate(id, props);
  }

  get contractId(): string {
    return this.props.contractId;
  }

  get studentId(): string {
    return this.props.studentId;
  }

  get iban(): Iban {
    return this.props.iban;
  }

  get reference(): string {
    return this.props.reference;
  }

  get status(): MandateStatus {
    return this.props.status;
  }

  get signedAt(): Date {
    return this.props.signedAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  revoke(now: Date): void {
    if (this.props.status !== 'active') {
      throw new InvalidStateTransitionError('PaymentMandate', this.props.status, 'revoked');
    }
    this.props = { ...this.props, status: 'revoked', revokedAt: now };
    this.record({
      eventType: BillingEvents.MandateRevoked,
      aggregateType: 'PaymentMandate',
      aggregateId: this.id,
      occurredAt: now,
      payload: { mandateId: this.id, contractId: this.props.contractId },
    });
  }
}
