import { uuidv7 } from 'uuidv7';

import {
  Contract,
  type ContractProduct,
  type ContractTerms,
  Disbursement,
  FinancingPlan,
} from '../../src/modules/lending/domain';
import { CalendarDate, Iban, Money, Percentage, unwrap } from '../../src/shared/domain';

export const NOW = new Date('2026-10-12T10:00:00Z');
export const LATER = new Date('2026-10-12T10:05:00Z');

export const INSTALLMENTS_24: ContractProduct = {
  kind: 'installments',
  termMonths: 24,
  annualRate: Percentage.fromPercent(7.5),
};

// 10 % of income above 1,500 a month, at most 36 payments and 1.5 times the principal, from the
// first full month three months after the program.
export const anIsa = (overrides: Partial<Extract<ContractProduct, { kind: 'isa' }>> = {}) =>
  ({
    kind: 'isa',
    incomeShare: Percentage.fromPercent(10),
    minMonthlyIncome: Money.fromCents(1_500_00),
    maxPayments: 36,
    capMultiplierHundredths: 150,
    graceMonths: 3,
    ...overrides,
  }) satisfies ContractProduct;

export const someTerms = (overrides: Partial<ContractTerms> = {}): ContractTerms => ({
  principal: Money.fromCents(7_500_00),
  platformFee: Percentage.fromPercent(5),
  product: INSTALLMENTS_24,
  ...overrides,
});

export function aContract(
  overrides: {
    terms?: Partial<ContractTerms>;
    studentId?: string;
    centerId?: string;
    applicationId?: string;
    now?: Date;
  } = {},
): Contract {
  return Contract.draw({
    id: uuidv7(),
    applicationId: overrides.applicationId ?? uuidv7(),
    studentId: overrides.studentId ?? uuidv7(),
    centerId: overrides.centerId ?? uuidv7(),
    program: { programId: uuidv7(), name: 'Full Stack Bootcamp', durationWeeks: 12 },
    terms: someTerms(overrides.terms),
    now: overrides.now ?? NOW,
  });
}

export const DOCUMENT_HASH = 'a'.repeat(64);

export function aContractSentForSignature(
  overrides: Parameters<typeof aContract>[0] = {},
): Contract {
  const contract = aContract(overrides);
  contract.sentForSignature(
    {
      provider: 'simulated',
      envelopeId: `env_${contract.id}`,
      document: `Contract ${contract.id}, as signed`,
      documentHash: DOCUMENT_HASH,
    },
    NOW,
  );
  contract.pullEvents();
  return contract;
}

export function aSignedContract(overrides: Parameters<typeof aContract>[0] = {}): Contract {
  const contract = aContractSentForSignature(overrides);
  contract.sign(
    { envelopeId: `env_${contract.id}`, documentHash: DOCUMENT_HASH, signedAt: NOW },
    NOW,
  );
  contract.pullEvents();
  return contract;
}

export function anActiveContract(overrides: Parameters<typeof aContract>[0] = {}): Contract {
  const contract = aSignedContract(overrides);
  contract.activate(NOW);
  contract.pullEvents();
  return contract;
}

// The payout account a started transfer pays.
export const A_CREDITOR = {
  iban: unwrap(Iban.create('ES9121000418450200051332')),
  holderName: 'Codeworks Madrid',
};

export function aDisbursement(
  overrides: { contractId?: string; centerId?: string } = {},
): Disbursement {
  return Disbursement.request({
    id: uuidv7(),
    contractId: overrides.contractId ?? uuidv7(),
    centerId: overrides.centerId ?? uuidv7(),
    amount: Money.fromCents(7_125_00),
    now: NOW,
  });
}

export function aPlan(
  overrides: {
    product?: ContractProduct;
    principal?: Money;
    activatedOn?: string;
    durationWeeks?: number;
    contractId?: string;
  } = {},
): FinancingPlan {
  return FinancingPlan.open({
    id: uuidv7(),
    contractId: overrides.contractId ?? uuidv7(),
    studentId: uuidv7(),
    centerId: uuidv7(),
    principal: overrides.principal ?? Money.fromCents(7_500_00),
    product: overrides.product ?? INSTALLMENTS_24,
    programDurationWeeks: overrides.durationWeeks ?? 12,
    activatedOn: CalendarDate.parse(overrides.activatedOn ?? '2026-10-12'),
    now: NOW,
  });
}
