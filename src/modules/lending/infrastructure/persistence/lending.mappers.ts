import { Injectable } from '@nestjs/common';

import { CalendarDate, Iban, Money, Percentage, unwrap } from '@shared/domain';
import { FieldCipher } from '@shared/infrastructure/crypto';

import {
  Contract,
  type ContractProduct,
  Disbursement,
  FinancingPlan,
  type InstallmentRow,
} from '../../domain';

import {
  type ContractOrmEntity,
  type DisbursementOrmEntity,
  type FinancingPlanOrmEntity,
  type InstallmentRowJson,
  type PlanTermsJson,
  type ProductTermsJson,
} from './lending.orm-entities';

export const ContractMapper = {
  toDomain(row: ContractOrmEntity): Contract {
    const signature =
      row.signatureProvider &&
      row.envelopeId &&
      row.document !== null &&
      row.documentHash &&
      row.sentForSignatureAt
        ? {
            provider: row.signatureProvider,
            envelopeId: row.envelopeId,
            document: row.document,
            documentHash: row.documentHash,
            sentAt: row.sentForSignatureAt,
            signedAt: row.signedAt,
          }
        : null;
    const contract = Contract.reconstitute(row.id, {
      applicationId: row.applicationId,
      studentId: row.studentId,
      centerId: row.centerId,
      program: {
        programId: row.programId,
        name: row.programName,
        durationWeeks: row.programDurationWeeks,
      },
      terms: {
        principal: Money.fromCents(row.principalCents),
        platformFee: Percentage.fromBasisPoints(row.platformFeeBps),
        product: productFromJson(row.productTerms),
      },
      signature,
      activatedOn: row.activatedOn === null ? null : CalendarDate.parse(row.activatedOn),
      cancellationReason: row.cancellationReason,
      arrearsChangedAt: row.arrearsChangedAt,
      status: row.status,
      statusChangedAt: row.statusChangedAt,
      createdAt: row.createdAt,
    });
    contract.markPersisted(row.version);
    return contract;
  },

  toRow(contract: Contract): Omit<ContractOrmEntity, 'version' | 'updatedAt'> {
    const { terms, program, signature } = contract;
    return {
      id: contract.id,
      applicationId: contract.applicationId,
      studentId: contract.studentId,
      centerId: contract.centerId,
      programId: program.programId,
      programName: program.name,
      programDurationWeeks: program.durationWeeks,
      principalCents: terms.principal.cents,
      platformFeeBps: terms.platformFee.basisPoints,
      product: terms.product.kind,
      productTerms: productToJson(terms.product),
      signatureProvider: signature?.provider ?? null,
      envelopeId: signature?.envelopeId ?? null,
      document: signature?.document ?? null,
      documentHash: signature?.documentHash ?? null,
      sentForSignatureAt: signature?.sentAt ?? null,
      signedAt: signature?.signedAt ?? null,
      activatedOn: contract.activatedOn?.toString() ?? null,
      cancellationReason: contract.cancellationReason,
      arrearsChangedAt: contract.arrearsChangedAt,
      status: contract.status,
      statusChangedAt: contract.statusChangedAt,
      createdAt: contract.createdAt,
    };
  },
};

// Binds the ciphertext to its row: copied into another disbursement, it no longer decrypts
// (ADR 014).
const creditorIbanContext = (disbursementId: string): string =>
  `lending.disbursements.creditor_iban:${disbursementId}`;

// A class: it needs the cipher for the creditor's IBAN.
@Injectable()
export class DisbursementMapper {
  constructor(private readonly cipher: FieldCipher) {}

  toDomain(row: DisbursementOrmEntity): Disbursement {
    const disbursement = Disbursement.reconstitute(row.id, {
      contractId: row.contractId,
      centerId: row.centerId,
      amount: Money.fromCents(row.amountCents),
      attempt: row.attempt,
      creditor:
        row.creditorIbanEncrypted && row.creditorName
          ? {
              iban: unwrap(
                Iban.create(
                  this.cipher.decrypt(row.creditorIbanEncrypted, creditorIbanContext(row.id)),
                ),
              ),
              holderName: row.creditorName,
            }
          : null,
      transferId: row.transferId,
      failureReason: row.failureReason,
      status: row.status,
      statusChangedAt: row.statusChangedAt,
      settledAt: row.settledAt,
      createdAt: row.createdAt,
    });
    disbursement.markPersisted(row.version);
    return disbursement;
  }

  toRow(disbursement: Disbursement): Omit<DisbursementOrmEntity, 'version' | 'updatedAt'> {
    const { creditor } = disbursement;
    return {
      id: disbursement.id,
      contractId: disbursement.contractId,
      centerId: disbursement.centerId,
      amountCents: disbursement.amount.cents,
      attempt: disbursement.attempt,
      creditorIbanEncrypted: creditor
        ? this.cipher.encrypt(creditor.iban.value, creditorIbanContext(disbursement.id))
        : null,
      creditorName: creditor?.holderName ?? null,
      transferId: disbursement.transferId,
      failureReason: disbursement.failureReason,
      status: disbursement.status,
      statusChangedAt: disbursement.statusChangedAt,
      settledAt: disbursement.settledAt,
      createdAt: disbursement.createdAt,
    };
  }
}

export const FinancingPlanMapper = {
  toDomain(row: FinancingPlanOrmEntity): FinancingPlan {
    const plan = FinancingPlan.reconstitute(row.id, {
      contractId: row.contractId,
      studentId: row.studentId,
      centerId: row.centerId,
      principal: Money.fromCents(row.principalCents),
      startsOn: CalendarDate.parse(row.startsOn),
      terms: planTermsFromJson(row.terms),
      status: row.status,
      completionReason: row.completionReason,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    });
    plan.markPersisted(row.version);
    return plan;
  },

  toRow(plan: FinancingPlan): Omit<FinancingPlanOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: plan.id,
      contractId: plan.contractId,
      studentId: plan.studentId,
      centerId: plan.centerId,
      kind: plan.terms.kind,
      principalCents: plan.principal.cents,
      startsOn: plan.startsOn.toString(),
      terms: planTermsToJson(plan),
      status: plan.status,
      completionReason: plan.completionReason,
      completedAt: plan.completedAt,
      createdAt: plan.createdAt,
    };
  },
};

export function rowFromJson(row: InstallmentRowJson): InstallmentRow {
  return {
    number: row.number,
    dueDate: CalendarDate.parse(row.dueDate),
    principal: Money.fromCents(row.principalCents),
    interest: Money.fromCents(row.interestCents),
    total: Money.fromCents(row.totalCents),
    balanceAfter: Money.fromCents(row.balanceAfterCents),
  };
}

function productFromJson(json: ProductTermsJson): ContractProduct {
  if (json.kind === 'installments') {
    return {
      kind: 'installments',
      termMonths: json.termMonths,
      annualRate: Percentage.fromBasisPoints(json.annualRateBps),
    };
  }
  return {
    kind: 'isa',
    incomeShare: Percentage.fromBasisPoints(json.incomeShareBps),
    minMonthlyIncome: Money.fromCents(json.minMonthlyIncomeCents),
    maxPayments: json.maxPayments,
    capMultiplierHundredths: json.capMultiplierHundredths,
    graceMonths: json.graceMonths,
  };
}

function productToJson(product: ContractProduct): ProductTermsJson {
  if (product.kind === 'installments') {
    return {
      kind: 'installments',
      termMonths: product.termMonths,
      annualRateBps: product.annualRate.basisPoints,
    };
  }
  return {
    kind: 'isa',
    incomeShareBps: product.incomeShare.basisPoints,
    minMonthlyIncomeCents: product.minMonthlyIncome.cents,
    maxPayments: product.maxPayments,
    capMultiplierHundredths: product.capMultiplierHundredths,
    graceMonths: product.graceMonths,
  };
}

function planTermsFromJson(json: PlanTermsJson): FinancingPlan['terms'] {
  if (json.kind === 'installments') {
    return {
      kind: 'installments',
      annualRate: Percentage.fromBasisPoints(json.annualRateBps),
      termMonths: json.termMonths,
      schedule: json.schedule.map(rowFromJson),
      paidInstallments: json.paidInstallments,
      paidByAttempt: Object.fromEntries(
        Object.entries(json.paidByAttempt ?? {}).map(([number, attempt]) => [
          Number(number),
          attempt,
        ]),
      ),
      payoffRequest: json.payoffRequest && {
        amount: Money.fromCents(json.payoffRequest.amountCents),
        asOf: CalendarDate.parse(json.payoffRequest.asOf),
        requestedAt: new Date(json.payoffRequest.requestedAt),
      },
    };
  }
  return {
    kind: 'isa',
    incomeShare: Percentage.fromBasisPoints(json.incomeShareBps),
    minMonthlyIncome: Money.fromCents(json.minMonthlyIncomeCents),
    maxPayments: json.maxPayments,
    cap: Money.fromCents(json.capCents),
    firstPeriod: CalendarDate.parse(json.firstPeriod),
    windowEndsOn: CalendarDate.parse(json.windowEndsOn),
    chargedSoFar: Money.fromCents(json.chargedSoFarCents),
    paymentsMade: json.paymentsMade,
    consecutiveMissingDeclarations: json.consecutiveMissingDeclarations,
    declarationOverdue: json.declarationOverdue,
    lastAssessedPeriod:
      json.lastAssessedPeriod === null ? null : CalendarDate.parse(json.lastAssessedPeriod),
  };
}

function planTermsToJson(plan: FinancingPlan): PlanTermsJson {
  const { terms } = plan;
  if (terms.kind === 'installments') {
    return {
      kind: 'installments',
      annualRateBps: terms.annualRate.basisPoints,
      termMonths: terms.termMonths,
      schedule: terms.schedule.map((row) => ({
        number: row.number,
        dueDate: row.dueDate.toString(),
        principalCents: row.principal.cents,
        interestCents: row.interest.cents,
        totalCents: row.total.cents,
        balanceAfterCents: row.balanceAfter.cents,
      })),
      paidInstallments: [...terms.paidInstallments],
      paidByAttempt: { ...terms.paidByAttempt },
      payoffRequest: terms.payoffRequest && {
        amountCents: terms.payoffRequest.amount.cents,
        asOf: terms.payoffRequest.asOf.toString(),
        requestedAt: terms.payoffRequest.requestedAt.toISOString(),
      },
    };
  }
  return {
    kind: 'isa',
    incomeShareBps: terms.incomeShare.basisPoints,
    minMonthlyIncomeCents: terms.minMonthlyIncome.cents,
    maxPayments: terms.maxPayments,
    capCents: terms.cap.cents,
    firstPeriod: terms.firstPeriod.toString(),
    windowEndsOn: terms.windowEndsOn.toString(),
    chargedSoFarCents: terms.chargedSoFar.cents,
    paymentsMade: terms.paymentsMade,
    consecutiveMissingDeclarations: terms.consecutiveMissingDeclarations,
    declarationOverdue: terms.declarationOverdue,
    lastAssessedPeriod: terms.lastAssessedPeriod?.toString() ?? null,
  };
}
