import {
  AggregateRoot,
  InvalidStateTransitionError,
  InvalidValueError,
  type Money,
  type Percentage,
} from '@shared/domain';

import { InvalidFinancingOptionError, ProgramNotPublishableError } from '../errors/catalog-errors';
import { CatalogEvents } from '../events/catalog-events';

import { type FinancingOptions } from './financing-options';

export const PROGRAM_MODALITIES = ['online', 'onsite', 'hybrid'] as const;
export type ProgramModality = (typeof PROGRAM_MODALITIES)[number];
export type ProgramStatus = 'draft' | 'published' | 'archived';

// An ISA is only fair to offer when most graduates get a job: Tramo is paid from their income.
export const MIN_EMPLOYABILITY_FOR_ISA_BPS = 6_000;
// Exported so request validation states the same bounds.
export const PROGRAM_LIMITS = {
  maxNameLength: 200,
  maxPriceCents: 10_000_000,
  maxDurationWeeks: 156,
  maxStartDates: 24,
} as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar day: Date.parse accepts 2027-02-30 and rolls it over to March.
const isCalendarDate = (date: string): boolean =>
  ISO_DATE.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);

export interface ProgramDetails {
  readonly name: string;
  readonly modality: ProgramModality;
  readonly price: Money;
  readonly durationWeeks: number;
  // Calendar dates (YYYY-MM-DD) of the next cohorts, in order.
  readonly startDates: readonly string[];
  // Share of graduates employed within six months, as reported by the center.
  readonly employabilityRate: Percentage;
  // Average gross annual salary of those graduates.
  readonly avgStartingSalary: Money;
}

export interface ProgramProps extends ProgramDetails {
  readonly centerId: string;
  readonly financing: FinancingOptions;
  readonly status: ProgramStatus;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
}

// A course of a training center that students can apply to finance. Created as a draft, it is
// published once it has at least one financing option that fits its numbers and its center is
// active; published programs are what the public catalog lists.
export class Program extends AggregateRoot {
  private constructor(
    id: string,
    private props: ProgramProps,
  ) {
    super(id);
  }

  static create(input: {
    id: string;
    centerId: string;
    details: ProgramDetails;
    financing: FinancingOptions;
    now: Date;
  }): Program {
    const details = Program.validDetails(input.details);
    Program.assertFinancingFits(input.financing, details);
    return new Program(input.id, {
      ...details,
      centerId: input.centerId,
      financing: input.financing,
      status: 'draft',
      publishedAt: null,
      createdAt: input.now,
    });
  }

  static reconstitute(id: string, props: ProgramProps): Program {
    return new Program(id, props);
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get details(): ProgramDetails {
    const {
      name,
      modality,
      price,
      durationWeeks,
      startDates,
      employabilityRate,
      avgStartingSalary,
    } = this.props;
    return {
      name,
      modality,
      price,
      durationWeeks,
      startDates,
      employabilityRate,
      avgStartingSalary,
    };
  }

  get financing(): FinancingOptions {
    return this.props.financing;
  }

  get status(): ProgramStatus {
    return this.props.status;
  }

  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get isPublished(): boolean {
    return this.props.status === 'published';
  }

  updateDetails(changes: Partial<ProgramDetails>): void {
    const details = Program.validDetails({ ...this.details, ...changes });
    Program.assertFinancingFits(this.props.financing, details);
    this.props = { ...this.props, ...details };
  }

  changeFinancing(financing: FinancingOptions, now: Date): void {
    Program.assertFinancingFits(financing, this.details);
    if (this.isPublished && financing.isEmpty) {
      throw new InvalidFinancingOptionError('a published program keeps at least one option');
    }
    if (financing.equals(this.props.financing)) {
      return;
    }
    this.props = { ...this.props, financing };
    if (this.isPublished) {
      this.recordFinancingChanged(now);
    }
  }

  // The center's state lives in another aggregate; the caller reads it and passes it in.
  publish(center: { readonly isActive: boolean }, now: Date): void {
    if (this.isPublished) {
      throw new InvalidStateTransitionError('Program', 'published', 'published');
    }
    if (!center.isActive) {
      throw new ProgramNotPublishableError('its training center is not active');
    }
    if (this.props.financing.isEmpty) {
      throw new ProgramNotPublishableError('it has no financing option');
    }
    this.props = { ...this.props, status: 'published', publishedAt: now };
    this.record({
      eventType: CatalogEvents.ProgramPublished,
      aggregateType: 'Program',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        programId: this.id,
        centerId: this.props.centerId,
        name: this.props.name,
        priceCents: this.props.price.cents,
        products: this.props.financing.products,
      },
    });
  }

  archive(now: Date): void {
    if (this.props.status === 'archived') {
      throw new InvalidStateTransitionError('Program', 'archived', 'archived');
    }
    const wasPublished = this.isPublished;
    this.props = { ...this.props, status: 'archived' };
    if (wasPublished) {
      this.record({
        eventType: CatalogEvents.ProgramArchived,
        aggregateType: 'Program',
        aggregateId: this.id,
        occurredAt: now,
        payload: { programId: this.id, centerId: this.props.centerId },
      });
    }
  }

  private recordFinancingChanged(now: Date): void {
    const { installments, isa, products } = this.props.financing;
    this.record({
      eventType: CatalogEvents.ProgramFinancingChanged,
      aggregateType: 'Program',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        programId: this.id,
        centerId: this.props.centerId,
        products,
        installmentTerms: installments?.allowedTerms ?? [],
        installmentAnnualRateBasisPoints: installments?.annualRate.basisPoints ?? null,
        isaIncomeShareBasisPoints: isa?.incomeShare.basisPoints ?? null,
      },
    });
  }

  private static assertFinancingFits(financing: FinancingOptions, details: ProgramDetails): void {
    if (financing.isa && details.employabilityRate.basisPoints < MIN_EMPLOYABILITY_FOR_ISA_BPS) {
      throw new InvalidFinancingOptionError('an ISA needs an employability rate of at least 60 %');
    }
  }

  private static validDetails(details: ProgramDetails): ProgramDetails {
    const name = details.name.trim();
    if (name.length === 0 || name.length > PROGRAM_LIMITS.maxNameLength) {
      throw new InvalidValueError(
        'name',
        `A program name must be 1 to ${String(PROGRAM_LIMITS.maxNameLength)} characters.`,
      );
    }
    if (!(PROGRAM_MODALITIES as readonly string[]).includes(details.modality)) {
      throw new InvalidValueError(
        'modality',
        `Modality must be one of ${PROGRAM_MODALITIES.join(', ')}.`,
      );
    }
    if (details.price.cents <= 0 || details.price.cents > PROGRAM_LIMITS.maxPriceCents) {
      throw new InvalidValueError('price', 'Price must be above 0 and at most 100,000 EUR.');
    }
    if (
      !Number.isInteger(details.durationWeeks) ||
      details.durationWeeks < 1 ||
      details.durationWeeks > PROGRAM_LIMITS.maxDurationWeeks
    ) {
      throw new InvalidValueError(
        'durationWeeks',
        `Duration must be 1 to ${String(PROGRAM_LIMITS.maxDurationWeeks)} weeks.`,
      );
    }
    if (details.avgStartingSalary.cents < 0) {
      throw new InvalidValueError('avgStartingSalary', 'Salary cannot be negative.');
    }
    const startDates = [...new Set(details.startDates)].sort();
    if (
      startDates.length > PROGRAM_LIMITS.maxStartDates ||
      !startDates.every((date) => isCalendarDate(date))
    ) {
      throw new InvalidValueError(
        'startDates',
        `Up to ${String(PROGRAM_LIMITS.maxStartDates)} calendar dates as YYYY-MM-DD.`,
      );
    }
    return { ...details, name, startDates };
  }
}
