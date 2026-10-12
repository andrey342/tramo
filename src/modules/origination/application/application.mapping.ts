import { annualPercentageRate, annuityPayment } from '@shared/domain';

import {
  type FinancingApplication,
  type ProgramSnapshot,
  type RequestedProduct,
  type RiskPolicy,
  VERIFICATION_TYPES,
} from '../domain';

import { type ApplicationDto, type DecisionDto, type OfferTermsDto } from './dto/application.dto';
import { type RiskPolicyDto } from './dto/risk-policy.dto';

export function toApplicationDto(
  application: FinancingApplication,
  { withProfile }: { withProfile: boolean },
): ApplicationDto {
  const { program, profile, product } = application;
  return {
    id: application.id,
    applicantId: application.applicantId,
    centerId: application.centerId,
    origin: application.origin,
    programId: program.programId,
    programName: program.name,
    amountCents: program.price.cents,
    currency: 'EUR',
    product:
      product.kind === 'isa'
        ? { kind: 'isa' }
        : { kind: 'installments', termMonths: product.termMonths },
    terms: offerTerms(program, product),
    profile: withProfile
      ? {
          dateOfBirth: profile.dateOfBirth,
          nationalIdMasked: profile.nationalId?.masked() ?? null,
          residenceCountry: profile.residenceCountry,
          declaredMonthlyIncomeCents: profile.declaredMonthlyIncome?.cents ?? null,
          employmentStatus: profile.employmentStatus,
        }
      : null,
    verificationsCompleted: VERIFICATION_TYPES.filter(
      (type) => application.verifications[type] !== null,
    ),
    status: application.status,
    // The score is built from the student's finances: same rule as the profile.
    score: withProfile ? (application.decision?.score ?? null) : null,
    statusChangedAt: application.statusChangedAt,
    createdAt: application.createdAt,
  };
}

// The snapshot always offers the product asked for: start and submit check it.
function offerTerms(program: ProgramSnapshot, product: RequestedProduct): OfferTermsDto {
  if (product.kind === 'isa') {
    const isa = program.isa;
    if (!isa) {
      throw new Error('An ISA application whose program offers no ISA.');
    }
    return {
      kind: 'isa',
      incomeShareBasisPoints: isa.incomeShare.basisPoints,
      minMonthlyIncomeCents: isa.minMonthlyIncome.cents,
      maxPayments: isa.maxPayments,
      capCents: program.price.multiply(isa.capMultiplierHundredths / 100).cents,
      graceMonths: isa.graceMonths,
    };
  }
  const installments = program.installments;
  if (!installments) {
    throw new Error('An instalment application whose program offers no instalments.');
  }
  return {
    kind: 'installments',
    termMonths: product.termMonths,
    annualRateBasisPoints: installments.annualRate.basisPoints,
    aprBasisPoints: annualPercentageRate(installments.annualRate).basisPoints,
    monthlyPaymentCents: annuityPayment(program.price, installments.annualRate, product.termMonths)
      .cents,
  };
}

export function toDecisionDto(application: FinancingApplication): DecisionDto | null {
  const { decision, manualDecision } = application;
  if (!decision) {
    return null;
  }
  return {
    outcome: decision.outcome,
    score: decision.score,
    factors: decision.factors.map((factor) => ({
      name: factor.name,
      weightBasisPoints: factor.weight.basisPoints,
      value: factor.value,
      points: factor.points,
    })),
    hardRulesBroken: decision.hardRulesBroken,
    reasons: decision.reasons,
    estimatedMonthlyPaymentCents: decision.estimatedMonthlyPayment.cents,
    policyVersion: decision.policyVersion,
    decidedAt: decision.decidedAt,
    manualDecision: manualDecision
      ? {
          outcome: manualDecision.outcome,
          reason: manualDecision.reason,
          decidedAt: manualDecision.decidedAt,
        }
      : null,
  };
}

export function toRiskPolicyDto(policy: RiskPolicy): RiskPolicyDto {
  const { weights } = policy;
  return {
    version: policy.version,
    maxFinanceableCents: policy.maxFinanceable.cents,
    minAgeYears: policy.minAgeYears,
    allowedResidenceCountries: policy.allowedResidenceCountries,
    weightsBasisPoints: {
      employability: weights.employability.basisPoints,
      employmentHistory: weights.employment_history.basisPoints,
      affordability: weights.affordability.basisPoints,
      bureau: weights.bureau.basisPoints,
    },
    approveThreshold: policy.approveThreshold,
    reviewThreshold: policy.reviewThreshold,
    createdAt: policy.createdAt,
    createdBy: policy.createdBy,
  };
}
