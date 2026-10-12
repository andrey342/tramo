import { type Charge, type IncomeDeclaration, type PaymentMandate } from '../domain';

import { type ChargeDto, type IncomeDeclarationDto, type MandateDto } from './dto/billing.dto';

export function toMandateDto(mandate: PaymentMandate): MandateDto {
  return {
    id: mandate.id,
    contractId: mandate.contractId,
    reference: mandate.reference,
    ibanMasked: mandate.iban.masked(),
    status: mandate.status,
    signedAt: mandate.signedAt,
  };
}

export function toDeclarationDto(declaration: IncomeDeclaration): IncomeDeclarationDto {
  return {
    id: declaration.id,
    contractId: declaration.contractId,
    period: declaration.period,
    grossMonthlyIncomeCents: declaration.grossMonthlyIncome.cents,
    source: declaration.source,
    declaredAt: declaration.declaredAt,
  };
}

export function toChargeDto(charge: Charge): ChargeDto {
  const failed = [...charge.attempts].reverse().find((attempt) => attempt.outcome === 'failed');
  return {
    id: charge.id,
    contractId: charge.contractId,
    kind: charge.kind,
    installmentNumber: charge.installmentNumber,
    period: charge.period,
    amountCents: charge.amount.cents,
    dueDate: charge.dueDate.toString(),
    status: charge.status,
    attempts: charge.attempts.length,
    lastFailureReason: failed?.failureReason ?? null,
    paidAt: charge.paidAt,
    createdAt: charge.createdAt,
  };
}
