import { type OfferAcceptedPayload } from '@modules/origination/domain/events/origination-events';
import { Money, Percentage } from '@shared/domain';

import { toOffer } from './contract-saga.consumers';

const common = {
  applicationId: '0199a000-0000-7000-8000-000000000001',
  applicantId: '0199a000-0000-7000-8000-000000000002',
  centerId: '0199a000-0000-7000-8000-000000000003',
  programId: '0199a000-0000-7000-8000-000000000004',
  programName: 'Full Stack Bootcamp',
  amountCents: 7_500_00,
};

describe('toOffer', () => {
  it('should read an accepted instalment offer as origination publishes it', () => {
    const payload: OfferAcceptedPayload = {
      ...common,
      product: { kind: 'installments', termMonths: 24, annualRateBasisPoints: 750 },
    };

    expect(toOffer(payload)).toEqual({
      applicationId: common.applicationId,
      studentId: common.applicantId,
      centerId: common.centerId,
      programId: common.programId,
      programName: 'Full Stack Bootcamp',
      principalCents: 7_500_00,
      product: {
        kind: 'installments',
        termMonths: 24,
        annualRate: Percentage.fromBasisPoints(750),
      },
    });
  });

  it('should read an accepted income share agreement as origination publishes it', () => {
    const payload: OfferAcceptedPayload = {
      ...common,
      product: {
        kind: 'isa',
        incomeShareBasisPoints: 1_000,
        minMonthlyIncomeCents: 1_500_00,
        maxPayments: 36,
        capMultiplierHundredths: 150,
        graceMonths: 3,
      },
    };

    expect(toOffer(payload).product).toEqual({
      kind: 'isa',
      incomeShare: Percentage.fromBasisPoints(1_000),
      minMonthlyIncome: Money.fromCents(1_500_00),
      maxPayments: 36,
      capMultiplierHundredths: 150,
      graceMonths: 3,
    });
  });
});
