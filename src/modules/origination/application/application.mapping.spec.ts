import { aDraftApplication } from '../../../../test/factories/origination';

import { toApplicationDto } from './application.mapping';

describe('toApplicationDto', () => {
  it('should show instalments as offered: TIN, TAE and the monthly payment', () => {
    // 7,500 at 7.5 % over 24 months.
    const dto = toApplicationDto(aDraftApplication(), { withProfile: false });

    expect(dto.terms).toEqual({
      kind: 'installments',
      termMonths: 24,
      annualRateBasisPoints: 750,
      aprBasisPoints: 776,
      monthlyPaymentCents: 33_750,
    });
  });

  it('should show an ISA as offered, with its cap in money', () => {
    // 10 % of income above 1,500 a month, at most 36 payments and 1.5 times the 7,500 price.
    const dto = toApplicationDto(aDraftApplication({ product: { kind: 'isa' } }), {
      withProfile: false,
    });

    expect(dto.terms).toEqual({
      kind: 'isa',
      incomeShareBasisPoints: 1_000,
      minMonthlyIncomeCents: 150_000,
      maxPayments: 36,
      capCents: 1_125_000,
      graceMonths: 3,
    });
  });
});
