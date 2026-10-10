import { InvalidStateTransitionError, InvalidValueError, Money, Percentage } from '@shared/domain';

import { aProgram, installments, isa, NOW } from '../../../../../test/factories/catalog';
import { InvalidFinancingOptionError, ProgramNotPublishableError } from '../errors/catalog-errors';
import { CatalogEvents } from '../events/catalog-events';

import { FinancingOptions } from './financing-options';

const ACTIVE = { isActive: true };
const LATER = new Date(NOW.getTime() + 60_000);

describe('FinancingOptions', () => {
  it('should sort and deduplicate instalment terms and list the products offered', () => {
    const options = FinancingOptions.of({ installments: installments([24, 12, 24]), isa: isa() });

    expect(options.installments?.allowedTerms).toEqual([12, 24]);
    expect(options.products).toEqual(['installments', 'isa']);
    expect(FinancingOptions.none().isEmpty).toBe(true);
  });

  it.each([
    ['a term under 6 months', { installments: installments([3]) }],
    ['a term over 48 months', { installments: installments([60]) }],
    ['no terms', { installments: installments([]) }],
    ['a rate above 25 %', { installments: installments([12], 30) }],
    ['a cap under 1.0', { isa: isa({ capMultiplierHundredths: 90 }) }],
    ['a cap over 2.0', { isa: isa({ capMultiplierHundredths: 210 }) }],
    ['an income share of 0 %', { isa: isa({ incomeShare: Percentage.zero() }) }],
    ['a non-positive minimum income', { isa: isa({ minMonthlyIncome: Money.zero() }) }],
    ['no payments', { isa: isa({ maxPayments: 0 }) }],
    ['a grace period over a year', { isa: isa({ graceMonths: 13 }) }],
  ])('should reject %s', (_case, input) => {
    expect(() => FinancingOptions.of(input)).toThrow(InvalidFinancingOptionError);
  });

  it('should accept the edges of the allowed ranges', () => {
    expect(() =>
      FinancingOptions.of({
        installments: installments([6, 48]),
        isa: isa({ capMultiplierHundredths: 100 }),
      }),
    ).not.toThrow();
    expect(() => FinancingOptions.of({ isa: isa({ capMultiplierHundredths: 200 }) })).not.toThrow();
  });
});

describe('Program', () => {
  it('should start as a draft without announcing anything', () => {
    const program = aProgram();

    expect(program.status).toBe('draft');
    expect(program.pullEvents()).toEqual([]);
  });

  it('should refuse an ISA when fewer than 60 % of graduates find a job', () => {
    expect(() =>
      aProgram({
        details: { employabilityRate: Percentage.fromPercent(59.99) },
        financing: FinancingOptions.of({ isa: isa() }),
      }),
    ).toThrow(InvalidFinancingOptionError);
    expect(() =>
      aProgram({
        details: { employabilityRate: Percentage.fromPercent(60) },
        financing: FinancingOptions.of({ isa: isa() }),
      }),
    ).not.toThrow();
  });

  it('should keep the ISA rule when the employability rate is lowered later', () => {
    const program = aProgram({ financing: FinancingOptions.of({ isa: isa() }) });

    expect(() => {
      program.updateDetails({ employabilityRate: Percentage.fromPercent(50) });
    }).toThrow(InvalidFinancingOptionError);
  });

  it('should validate its details', () => {
    expect(() => aProgram({ details: { name: ' ' } })).toThrow(InvalidValueError);
    expect(() => aProgram({ details: { price: Money.zero() } })).toThrow(InvalidValueError);
    expect(() => aProgram({ details: { durationWeeks: 0 } })).toThrow(InvalidValueError);
    expect(() => aProgram({ details: { startDates: ['2027-13-40'] } })).toThrow(InvalidValueError);
    expect(() => aProgram({ details: { avgStartingSalary: Money.fromCents(-1) } })).toThrow(
      InvalidValueError,
    );
    expect(
      aProgram({ details: { startDates: ['2027-04-05', '2027-01-11', '2027-01-11'] } }).details
        .startDates,
    ).toEqual(['2027-01-11', '2027-04-05']);
  });

  describe('publishing', () => {
    it('should publish a program with an option when its center is active', () => {
      const program = aProgram({
        financing: FinancingOptions.of({ installments: installments(), isa: isa() }),
      });

      program.publish(ACTIVE, LATER);

      expect(program.status).toBe('published');
      expect(program.publishedAt).toEqual(LATER);
      expect(program.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: CatalogEvents.ProgramPublished,
          payload: expect.objectContaining({
            priceCents: 750_000,
            products: ['installments', 'isa'],
          }) as object,
        }),
      ]);
    });

    it('should refuse to publish without a financing option or an active center', () => {
      const bare = aProgram({ financing: FinancingOptions.none() });

      expect(() => {
        bare.publish(ACTIVE, LATER);
      }).toThrow(ProgramNotPublishableError);
      expect(() => {
        aProgram().publish({ isActive: false }, LATER);
      }).toThrow(ProgramNotPublishableError);
    });

    it('should refuse to publish twice and to archive twice', () => {
      const program = aProgram();
      program.publish(ACTIVE, LATER);

      expect(() => {
        program.publish(ACTIVE, LATER);
      }).toThrow(InvalidStateTransitionError);
      program.archive(LATER);
      expect(() => {
        program.archive(LATER);
      }).toThrow(InvalidStateTransitionError);
    });

    it('should announce archiving only for a program that was published', () => {
      const draft = aProgram();
      const published = aProgram();
      published.publish(ACTIVE, LATER);
      published.pullEvents();

      draft.archive(LATER);
      published.archive(LATER);

      expect(draft.pullEvents()).toEqual([]);
      expect(published.pullEvents().map((event) => event.eventType)).toEqual([
        CatalogEvents.ProgramArchived,
      ]);
    });

    it('should publish an archived program again', () => {
      const program = aProgram();
      program.archive(LATER);

      program.publish(ACTIVE, LATER);

      expect(program.status).toBe('published');
    });
  });

  describe('financing changes', () => {
    it('should announce new options of a published program, and only when they change', () => {
      const program = aProgram();
      program.publish(ACTIVE, LATER);
      program.pullEvents();

      program.changeFinancing(FinancingOptions.of({ installments: installments() }), LATER);
      program.changeFinancing(
        FinancingOptions.of({ installments: installments([12, 36], 6) }),
        LATER,
      );

      expect(program.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: CatalogEvents.ProgramFinancingChanged,
          payload: expect.objectContaining({
            installmentTerms: [12, 36],
            installmentAnnualRateBasisPoints: 600,
            isaIncomeShareBasisPoints: null,
          }) as object,
        }),
      ]);
    });

    it('should change a draft silently and keep a published program financeable', () => {
      const draft = aProgram();
      draft.changeFinancing(FinancingOptions.none(), LATER);
      const published = aProgram();
      published.publish(ACTIVE, LATER);

      expect(draft.pullEvents()).toEqual([]);
      expect(() => {
        published.changeFinancing(FinancingOptions.none(), LATER);
      }).toThrow(InvalidFinancingOptionError);
    });
  });
});
