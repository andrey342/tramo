import { Injectable } from '@nestjs/common';

import { Money, NationalId, Percentage, unwrap } from '@shared/domain';
import { FieldCipher } from '@shared/infrastructure/crypto';

import {
  type DecisionRecord,
  FinancingApplication,
  type ProgramSnapshot,
  RiskPolicy,
} from '../../domain';

import {
  type DecisionJson,
  type FinancingApplicationOrmEntity,
  type ProgramSnapshotJson,
} from './financing-application.orm-entity';
import { type RiskPolicyOrmEntity } from './risk-policy.orm-entity';

// Binds the ciphertext to its row: copied into another application, it no longer decrypts.
const nationalIdContext = (applicationId: string): string =>
  `origination.financing_applications.national_id:${applicationId}`;

// A class rather than a plain object: it needs the cipher for the national id.
@Injectable()
export class FinancingApplicationMapper {
  constructor(private readonly cipher: FieldCipher) {}

  toDomain(row: FinancingApplicationOrmEntity): FinancingApplication {
    const application = FinancingApplication.reconstitute(row.id, {
      applicantId: row.applicantId,
      origin: row.origin,
      program: programFromJson(row.programId, row.centerId, row.programSnapshot),
      product:
        row.product === 'isa'
          ? { kind: 'isa' }
          : { kind: 'installments', termMonths: row.termMonths ?? 0 },
      profile: {
        dateOfBirth: row.dateOfBirth,
        nationalId: row.nationalIdEncrypted
          ? unwrap(
              NationalId.create(
                this.cipher.decrypt(row.nationalIdEncrypted, nationalIdContext(row.id)),
              ),
            )
          : null,
        residenceCountry: row.residenceCountry,
        declaredMonthlyIncome:
          row.declaredMonthlyIncomeCents === null
            ? null
            : Money.fromCents(row.declaredMonthlyIncomeCents),
        employmentStatus: row.employmentStatus,
      },
      verifications: {
        kyc: row.kyc && {
          verified: row.kyc.verified,
          confidence: Percentage.fromBasisPoints(row.kyc.confidenceBps),
          reasons: row.kyc.reasons,
          provider: row.kyc.provider,
          checkedAt: new Date(row.kyc.checkedAt),
        },
        employment: row.employment && {
          monthsWorkedLast24: row.employment.monthsWorkedLast24,
          currentlyEmployed: row.employment.currentlyEmployed,
          currentMonthlyIncome:
            row.employment.currentMonthlyIncomeCents === null
              ? null
              : Money.fromCents(row.employment.currentMonthlyIncomeCents),
          provider: row.employment.provider,
          checkedAt: new Date(row.employment.checkedAt),
        },
        bureau: row.bureau && { ...row.bureau, checkedAt: new Date(row.bureau.checkedAt) },
      },
      decision: row.decision && decisionFromJson(row.decision),
      manualDecision: row.manualDecision && {
        ...row.manualDecision,
        decidedAt: new Date(row.manualDecision.decidedAt),
      },
      status: row.status,
      statusChangedAt: row.statusChangedAt,
      createdAt: row.createdAt,
    });
    application.markPersisted(row.version);
    return application;
  }

  toRow(application: FinancingApplication): Omit<FinancingApplicationOrmEntity, 'version'> {
    const { program, product, profile, verifications } = application;
    const { kyc, employment, bureau } = verifications;
    const { decision, manualDecision } = application;
    return {
      id: application.id,
      applicantId: application.applicantId,
      origin: application.origin,
      centerId: program.centerId,
      programId: program.programId,
      programSnapshot: programToJson(program),
      product: product.kind,
      termMonths: product.kind === 'installments' ? product.termMonths : null,
      dateOfBirth: profile.dateOfBirth,
      nationalIdEncrypted: profile.nationalId
        ? this.cipher.encrypt(profile.nationalId.value, nationalIdContext(application.id))
        : null,
      residenceCountry: profile.residenceCountry,
      declaredMonthlyIncomeCents: profile.declaredMonthlyIncome?.cents ?? null,
      employmentStatus: profile.employmentStatus,
      kyc: kyc && {
        verified: kyc.verified,
        confidenceBps: kyc.confidence.basisPoints,
        reasons: [...kyc.reasons],
        provider: kyc.provider,
        checkedAt: kyc.checkedAt.toISOString(),
      },
      employment: employment && {
        monthsWorkedLast24: employment.monthsWorkedLast24,
        currentlyEmployed: employment.currentlyEmployed,
        currentMonthlyIncomeCents: employment.currentMonthlyIncome?.cents ?? null,
        provider: employment.provider,
        checkedAt: employment.checkedAt.toISOString(),
      },
      bureau: bureau && {
        listedInDefaultRegistry: bureau.listedInDefaultRegistry,
        score: bureau.score,
        provider: bureau.provider,
        checkedAt: bureau.checkedAt.toISOString(),
      },
      decision: decision && decisionToJson(decision),
      manualDecision: manualDecision && {
        ...manualDecision,
        decidedAt: manualDecision.decidedAt.toISOString(),
      },
      score: decision?.score ?? null,
      status: application.status,
      statusChangedAt: application.statusChangedAt,
      createdAt: application.createdAt,
    };
  }
}

export function programFromJson(
  programId: string,
  centerId: string,
  json: ProgramSnapshotJson,
): ProgramSnapshot {
  return {
    programId,
    centerId,
    name: json.name,
    price: Money.fromCents(json.priceCents),
    employabilityRate: Percentage.fromBasisPoints(json.employabilityBps),
    avgStartingSalary: Money.fromCents(json.avgStartingSalaryCents),
    installments: json.installments && {
      allowedTerms: json.installments.allowedTerms,
      annualRate: Percentage.fromBasisPoints(json.installments.annualRateBps),
    },
    isa: json.isa && {
      incomeShare: Percentage.fromBasisPoints(json.isa.incomeShareBps),
      minMonthlyIncome: Money.fromCents(json.isa.minMonthlyIncomeCents),
      maxPayments: json.isa.maxPayments,
      capMultiplierHundredths: json.isa.capMultiplierHundredths,
      graceMonths: json.isa.graceMonths,
    },
  };
}

function programToJson(program: ProgramSnapshot): ProgramSnapshotJson {
  return {
    name: program.name,
    priceCents: program.price.cents,
    employabilityBps: program.employabilityRate.basisPoints,
    avgStartingSalaryCents: program.avgStartingSalary.cents,
    installments: program.installments && {
      allowedTerms: [...program.installments.allowedTerms],
      annualRateBps: program.installments.annualRate.basisPoints,
    },
    isa: program.isa && {
      incomeShareBps: program.isa.incomeShare.basisPoints,
      minMonthlyIncomeCents: program.isa.minMonthlyIncome.cents,
      maxPayments: program.isa.maxPayments,
      capMultiplierHundredths: program.isa.capMultiplierHundredths,
      graceMonths: program.isa.graceMonths,
    },
  };
}

function decisionToJson(decision: DecisionRecord): DecisionJson {
  return {
    outcome: decision.outcome,
    score: decision.score,
    factors: decision.factors.map((factor) => ({
      name: factor.name,
      weightBps: factor.weight.basisPoints,
      value: factor.value,
      points: factor.points,
    })),
    hardRulesBroken: [...decision.hardRulesBroken],
    reasons: [...decision.reasons],
    estimatedMonthlyPaymentCents: decision.estimatedMonthlyPayment.cents,
    policyVersion: decision.policyVersion,
    decidedAt: decision.decidedAt.toISOString(),
  };
}

function decisionFromJson(json: DecisionJson): DecisionRecord {
  return {
    outcome: json.outcome,
    score: json.score,
    hardRulesBroken: json.hardRulesBroken,
    reasons: json.reasons,
    policyVersion: json.policyVersion,
    factors: json.factors.map((factor) => ({
      name: factor.name,
      weight: Percentage.fromBasisPoints(factor.weightBps),
      value: factor.value,
      points: factor.points,
    })),
    estimatedMonthlyPayment: Money.fromCents(json.estimatedMonthlyPaymentCents),
    decidedAt: new Date(json.decidedAt),
  };
}

export const RiskPolicyMapper = {
  toDomain(row: RiskPolicyOrmEntity): RiskPolicy {
    return RiskPolicy.reconstitute(row.version, {
      maxFinanceable: Money.fromCents(row.maxFinanceableCents),
      minAgeYears: row.minAgeYears,
      allowedResidenceCountries: row.allowedResidenceCountries,
      weights: {
        employability: Percentage.fromBasisPoints(row.weightEmployabilityBps),
        employment_history: Percentage.fromBasisPoints(row.weightEmploymentHistoryBps),
        affordability: Percentage.fromBasisPoints(row.weightAffordabilityBps),
        bureau: Percentage.fromBasisPoints(row.weightBureauBps),
      },
      approveThreshold: row.approveThreshold,
      reviewThreshold: row.reviewThreshold,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    });
  },

  toRow(policy: RiskPolicy): RiskPolicyOrmEntity {
    return {
      version: policy.version,
      maxFinanceableCents: policy.maxFinanceable.cents,
      minAgeYears: policy.minAgeYears,
      allowedResidenceCountries: [...policy.allowedResidenceCountries],
      weightEmployabilityBps: policy.weights.employability.basisPoints,
      weightEmploymentHistoryBps: policy.weights.employment_history.basisPoints,
      weightAffordabilityBps: policy.weights.affordability.basisPoints,
      weightBureauBps: policy.weights.bureau.basisPoints,
      approveThreshold: policy.approveThreshold,
      reviewThreshold: policy.reviewThreshold,
      createdAt: policy.createdAt,
      createdBy: policy.createdBy,
    };
  },
};
