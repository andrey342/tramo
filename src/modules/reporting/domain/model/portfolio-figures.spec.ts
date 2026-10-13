import { InvalidValueError, Money } from '@shared/domain';

import { averageOf, centerFigures, shareOf } from './portfolio-figures';

describe('portfolio figures', () => {
  // 1 of 3 is 33.333...%: 3333 bp; 2 of 3 rounds up to 6667 bp.
  it('should give a share in basis points, half up, and none without a whole', () => {
    expect(shareOf(1, 3)?.basisPoints).toBe(3_333);
    expect(shareOf(2, 3)?.basisPoints).toBe(6_667);
    expect(shareOf(3, 3)?.basisPoints).toBe(10_000);
    expect(shareOf(0, 0)).toBeNull();
    expect(() => shareOf(4, 3)).toThrow(InvalidValueError);
    expect(() => shareOf(0.5, 3)).toThrow(InvalidValueError);
  });

  it('should give the mean amount, half up to the cent, and none for no amount', () => {
    expect(averageOf(1_000_01, 2)).toEqual(Money.fromCents(500_01));
    expect(averageOf(7_500_00, 1)).toEqual(Money.fromCents(7_500_00));
    expect(averageOf(0, 0)).toBeNull();
  });

  it('should refuse a sum that is not whole cents when adding the money up', () => {
    const rows = { applications: [], contracts: [], disbursements: [] };

    expect(() =>
      centerFigures({
        ...rows,
        charges: [{ product: 'isa', kind: 'isa', status: 'paid', cents: 100.5 }],
      }),
    ).toThrow(InvalidValueError);
  });

  it('should add the rows up in total and by product, leaving out what is not counted', () => {
    const figures = centerFigures({
      applications: [
        { status: 'approved', count: 2 },
        { status: 'needs_review', count: 1 },
        { status: 'scoring', count: 4 },
      ],
      contracts: [
        { product: 'installments', status: 'active', count: 3 },
        { product: 'isa', status: 'in_arrears', count: 1 },
        { product: null, status: 'active', count: 1 },
        { product: 'isa', status: 'pending_signature', count: 5 },
      ],
      disbursements: [
        { product: 'installments', status: 'settled', cents: 7_000_00 },
        { product: 'installments', status: 'failed', cents: 9_000_00 },
      ],
      charges: [
        { product: 'installments', kind: 'installment', status: 'paid', cents: 300_00 },
        { product: 'isa', kind: 'installment', status: 'overdue', cents: 150_00 },
        { product: 'installments', kind: 'payoff', status: 'scheduled', cents: 6_000_00 },
        { product: 'isa', kind: 'installment', status: 'written_off', cents: 80_00 },
        { product: 'installments', kind: 'installment', status: 'cancelled', cents: 999_00 },
      ],
    });

    expect(figures.applications).toMatchObject({ approved: 2, needsReview: 1, submitted: 0 });
    expect(figures.contracts).toEqual({
      active: 4,
      inArrears: 1,
      completed: 0,
      defaulted: 0,
      cancelled: 0,
    });
    expect(figures).toMatchObject({
      disbursedCents: 7_000_00,
      collectedCents: 300_00,
      outstandingCents: 150_00,
      writtenOffCents: 80_00,
    });
    expect(figures.byProduct).toEqual([
      {
        product: 'installments',
        contracts: { active: 3, inArrears: 0, completed: 0, defaulted: 0, cancelled: 0 },
        disbursedCents: 7_000_00,
        collectedCents: 300_00,
        outstandingCents: 0,
        writtenOffCents: 0,
      },
      {
        product: 'isa',
        contracts: { active: 0, inArrears: 1, completed: 0, defaulted: 0, cancelled: 0 },
        disbursedCents: 0,
        collectedCents: 0,
        outstandingCents: 150_00,
        writtenOffCents: 80_00,
      },
    ]);
  });
});
