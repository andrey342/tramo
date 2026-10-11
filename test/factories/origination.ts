import { uuidv7 } from 'uuidv7';

import {
  type ApplicantProfile,
  type BureauResult,
  type CompleteProfile,
  type EmploymentResult,
  FinancingApplication,
  type KycResult,
  type ProgramSnapshot,
  type RequestedProduct,
} from '../../src/modules/origination/domain';
import { Money, NationalId, Percentage, unwrap } from '../../src/shared/domain';

export const NOW = new Date('2026-10-09T10:00:00Z');
export const LATER = new Date('2026-10-09T10:05:00Z');
// 12345678 mod 23 = 14, letter Z. Its last digit (8) is neither 7 nor 9, the fake providers'
// failing cases.
export const VALID_DNI = '12345678Z';

export const aProgramSnapshot = (overrides: Partial<ProgramSnapshot> = {}): ProgramSnapshot => ({
  programId: uuidv7(),
  centerId: uuidv7(),
  name: 'Full Stack Bootcamp',
  price: Money.fromCents(7_500_00),
  employabilityRate: Percentage.fromPercent(85),
  avgStartingSalary: Money.fromCents(28_000_00),
  installments: { allowedTerms: [12, 24, 36], annualRate: Percentage.fromPercent(7.5) },
  isa: {
    incomeShare: Percentage.fromPercent(10),
    minMonthlyIncome: Money.fromCents(1_500_00),
    maxPayments: 36,
    capMultiplierHundredths: 150,
    graceMonths: 3,
  },
  ...overrides,
});

export const aCompleteProfile = (overrides: Partial<CompleteProfile> = {}): CompleteProfile => ({
  dateOfBirth: '1998-05-20',
  nationalId: unwrap(NationalId.create(VALID_DNI)),
  residenceCountry: 'ES',
  declaredMonthlyIncome: Money.fromCents(1_800_00),
  employmentStatus: 'employed',
  ...overrides,
});

export const INSTALLMENTS_24: RequestedProduct = { kind: 'installments', termMonths: 24 };

export function aDraftApplication(
  overrides: {
    applicantId?: string;
    program?: ProgramSnapshot;
    product?: RequestedProduct;
    profile?: ApplicantProfile;
  } = {},
): FinancingApplication {
  return FinancingApplication.start({
    id: uuidv7(),
    applicantId: overrides.applicantId ?? uuidv7(),
    origin: 'student',
    program: overrides.program ?? aProgramSnapshot(),
    product: overrides.product ?? INSTALLMENTS_24,
    profile: overrides.profile ?? aCompleteProfile(),
    now: NOW,
  });
}

export function aSubmittedApplication(
  overrides: Parameters<typeof aDraftApplication>[0] = {},
): FinancingApplication {
  const application = aDraftApplication(overrides);
  application.submit(application.program, NOW);
  application.pullEvents();
  return application;
}

export const passedKyc = (overrides: Partial<KycResult> = {}): KycResult => ({
  verified: true,
  confidence: Percentage.fromPercent(97),
  reasons: [],
  provider: 'fake',
  ...overrides,
});

export const steadyEmployment = (overrides: Partial<EmploymentResult> = {}): EmploymentResult => ({
  monthsWorkedLast24: 24,
  currentlyEmployed: true,
  currentMonthlyIncome: Money.fromCents(1_800_00),
  provider: 'fake',
  ...overrides,
});

export const cleanBureau = (overrides: Partial<BureauResult> = {}): BureauResult => ({
  listedInDefaultRegistry: false,
  score: 800,
  provider: 'fake',
  ...overrides,
});

// Submitted and fully verified: the next step is scoring.
export function anApplicationInScoring(
  overrides: Parameters<typeof aDraftApplication>[0] = {},
): FinancingApplication {
  const application = aSubmittedApplication(overrides);
  application.recordVerification({ type: 'kyc', result: passedKyc() }, NOW);
  application.recordVerification({ type: 'employment', result: steadyEmployment() }, NOW);
  application.recordVerification({ type: 'bureau', result: cleanBureau() }, NOW);
  application.pullEvents();
  return application;
}
