import { uuidv7 } from 'uuidv7';

import {
  FinancingOptions,
  type InstallmentsOption,
  type IsaOption,
  Program,
  type ProgramDetails,
  TrainingCenter,
} from '../../src/modules/catalog/domain';
import { Iban, Money, Percentage, unwrap, VatNumber } from '../../src/shared/domain';

export const NOW = new Date('2026-10-09T10:00:00Z');
export const VALID_IBAN = 'ES9121000418450200051332';
export const OTHER_IBAN = 'DE89370400440532013000';

// Tax ids are unique per center, so each call gets its own unless one is given.
export const aTaxId = (): string => `B${uuidv7().replace(/\D/g, '').slice(-8)}`;

export function aTrainingCenter(
  overrides: { id?: string; name?: string; taxId?: string; feePercent?: number } = {},
): TrainingCenter {
  return TrainingCenter.register({
    id: overrides.id ?? uuidv7(),
    name: overrides.name ?? 'Codeworks Barcelona',
    vatNumber: unwrap(VatNumber.create('ES', overrides.taxId ?? aTaxId())),
    payoutIban: unwrap(Iban.create(VALID_IBAN)),
    platformFee: Percentage.fromPercent(overrides.feePercent ?? 5),
    now: NOW,
  });
}

export function anActiveTrainingCenter(
  overrides: Parameters<typeof aTrainingCenter>[0] = {},
): TrainingCenter {
  const center = aTrainingCenter(overrides);
  center.recordVatCheck({ outcome: 'valid', provider: 'fake', registeredName: center.name }, NOW);
  center.pullEvents();
  return center;
}

export const installments = (
  terms: number[] = [12, 24],
  ratePercent = 7.5,
): InstallmentsOption => ({
  allowedTerms: terms,
  annualRate: Percentage.fromPercent(ratePercent),
});

export const isa = (overrides: Partial<IsaOption> = {}): IsaOption => ({
  incomeShare: Percentage.fromPercent(10),
  minMonthlyIncome: Money.fromCents(1_500_00),
  maxPayments: 36,
  capMultiplierHundredths: 150,
  graceMonths: 3,
  ...overrides,
});

export const programDetails = (overrides: Partial<ProgramDetails> = {}): ProgramDetails => ({
  name: 'Full Stack Bootcamp',
  modality: 'hybrid',
  price: Money.fromCents(7_500_00),
  durationWeeks: 16,
  startDates: ['2027-01-11', '2027-04-05'],
  employabilityRate: Percentage.fromPercent(85),
  avgStartingSalary: Money.fromCents(28_000_00),
  ...overrides,
});

export function aProgram(
  overrides: {
    centerId?: string;
    details?: Partial<ProgramDetails>;
    financing?: FinancingOptions;
  } = {},
): Program {
  return Program.create({
    id: uuidv7(),
    centerId: overrides.centerId ?? uuidv7(),
    details: programDetails(overrides.details),
    financing: overrides.financing ?? FinancingOptions.of({ installments: installments() }),
    now: NOW,
  });
}
