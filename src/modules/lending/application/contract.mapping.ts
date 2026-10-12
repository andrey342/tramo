import {
  annualPercentageRateOf,
  type Contract,
  type Disbursement,
  disbursementAmount,
  type FinancingPlan,
  isaCap,
  monthlyInstallment,
  type PayoffQuote,
} from '../domain';

import {
  type ContractDto,
  type ContractProductDto,
  type DisbursementDto,
  type PayoffQuoteDto,
  type ScheduleDto,
} from './dto/contract.dto';
import { type BillablePlanDto } from './dto/plan-lookup';

export function toContractDto(
  contract: Contract,
  payout: { visible: boolean; disbursement: Disbursement | null },
): ContractDto {
  const { terms, program, signature } = contract;
  return {
    id: contract.id,
    applicationId: contract.applicationId,
    studentId: contract.studentId,
    centerId: contract.centerId,
    program: { id: program.programId, name: program.name, durationWeeks: program.durationWeeks },
    principalCents: terms.principal.cents,
    currency: 'EUR',
    product: toProductDto(contract),
    payout: payout.visible
      ? {
          platformFeeBasisPoints: terms.platformFee.basisPoints,
          disbursementAmountCents: disbursementAmount(terms).cents,
          disbursementStatus: payout.disbursement?.status ?? null,
          settledAt: payout.disbursement?.settledAt ?? null,
        }
      : null,
    signature: signature && {
      provider: signature.provider,
      envelopeId: signature.envelopeId,
      documentHash: signature.documentHash,
      sentAt: signature.sentAt,
      signedAt: signature.signedAt,
    },
    status: contract.status,
    activatedOn: contract.activatedOn?.toString() ?? null,
    cancellationReason: contract.cancellationReason,
    statusChangedAt: contract.statusChangedAt,
    createdAt: contract.createdAt,
  };
}

function toProductDto(contract: Contract): ContractProductDto {
  const { terms } = contract;
  const { product } = terms;
  if (product.kind === 'isa') {
    return {
      kind: 'isa',
      incomeShareBasisPoints: product.incomeShare.basisPoints,
      minMonthlyIncomeCents: product.minMonthlyIncome.cents,
      maxPayments: product.maxPayments,
      capCents: isaCap(terms.principal, product.capMultiplierHundredths).cents,
      graceMonths: product.graceMonths,
    };
  }
  return {
    kind: 'installments',
    termMonths: product.termMonths,
    annualRateBasisPoints: product.annualRate.basisPoints,
    aprBasisPoints: annualPercentageRateOf(terms)?.basisPoints ?? 0,
    monthlyPaymentCents: monthlyInstallment(terms)?.cents ?? 0,
  };
}

export function toScheduleDto(plan: FinancingPlan): ScheduleDto {
  const common = {
    contractId: plan.contractId,
    startsOn: plan.startsOn.toString(),
    status: plan.status,
    completionReason: plan.completionReason,
  };
  const { terms } = plan;
  if (terms.kind === 'installments') {
    return {
      ...common,
      kind: 'installments',
      installmentsPaid: terms.paidInstallments.length,
      installments: terms.schedule.map((row) => ({
        number: row.number,
        dueDate: row.dueDate.toString(),
        principalCents: row.principal.cents,
        interestCents: row.interest.cents,
        totalCents: row.total.cents,
        balanceAfterCents: row.balanceAfter.cents,
        paid: terms.paidInstallments.includes(row.number),
      })),
      payoffRequested: terms.payoffRequest && {
        amountCents: terms.payoffRequest.amount.cents,
        asOf: terms.payoffRequest.asOf.toString(),
      },
    };
  }
  return {
    ...common,
    kind: 'isa',
    incomeShareBasisPoints: terms.incomeShare.basisPoints,
    minMonthlyIncomeCents: terms.minMonthlyIncome.cents,
    maxPayments: terms.maxPayments,
    capCents: terms.cap.cents,
    firstPeriod: terms.firstPeriod.period,
    windowEndsOn: terms.windowEndsOn.toString(),
    chargedSoFarCents: terms.chargedSoFar.cents,
    paymentsMade: terms.paymentsMade,
    declarationOverdue: terms.declarationOverdue,
  };
}

export function toBillablePlanDto(
  plan: FinancingPlan,
  contractStatus: BillablePlanDto['contractStatus'],
): BillablePlanDto {
  const { terms } = plan;
  return {
    contractId: plan.contractId,
    studentId: plan.studentId,
    centerId: plan.centerId,
    contractStatus,
    kind: terms.kind,
    unpaidInstallments:
      terms.kind === 'installments'
        ? terms.schedule
            .filter((row) => !terms.paidInstallments.includes(row.number))
            .map((row) => ({
              number: row.number,
              dueDate: row.dueDate.toString(),
              totalCents: row.total.cents,
            }))
        : [],
    nextIsaPeriod:
      terms.kind === 'isa'
        ? (terms.lastAssessedPeriod?.addMonths(1) ?? terms.firstPeriod).period
        : null,
  };
}

export function toPayoffQuoteDto(contractId: string, quote: PayoffQuote): PayoffQuoteDto {
  return {
    contractId,
    asOf: quote.asOf.toString(),
    overdueInstallments: quote.overdueInstallments,
    overdueAmountCents: quote.overdueAmount.cents,
    outstandingPrincipalCents: quote.outstandingPrincipal.cents,
    accruedInterestCents: quote.accruedInterest.cents,
    totalCents: quote.total.cents,
  };
}

export function toDisbursementDto(disbursement: Disbursement): DisbursementDto {
  return {
    id: disbursement.id,
    contractId: disbursement.contractId,
    centerId: disbursement.centerId,
    amountCents: disbursement.amount.cents,
    attempt: disbursement.attempt,
    status: disbursement.status,
    failureReason: disbursement.failureReason,
    statusChangedAt: disbursement.statusChangedAt,
    settledAt: disbursement.settledAt,
    createdAt: disbursement.createdAt,
  };
}
