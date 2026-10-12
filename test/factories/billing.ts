import { uuidv7 } from 'uuidv7';

import { Charge, IncomeDeclaration, PaymentMandate } from '../../src/modules/billing/domain';
import { type ChargeKind } from '../../src/modules/billing/domain/events/billing-events';
import { CalendarDate, Iban, Money, unwrap } from '../../src/shared/domain';

export const NOW = new Date('2026-11-12T08:00:00Z');
export const LATER = new Date('2026-11-12T09:00:00Z');
export const STUDENT_IBAN = 'ES7620770024003102575766';

export const day = (iso: string): CalendarDate => CalendarDate.parse(iso);

export function aCharge(
  overrides: {
    contractId?: string;
    studentId?: string;
    centerId?: string;
    kind?: ChargeKind;
    reference?: string;
    installmentNumber?: number | null;
    amountCents?: number;
    dueDate?: string;
  } = {},
): Charge {
  const dueDate = day(overrides.dueDate ?? '2026-11-12');
  const kind = overrides.kind ?? 'installment';
  const installmentNumber =
    overrides.installmentNumber === undefined
      ? kind === 'installment'
        ? 1
        : null
      : overrides.installmentNumber;
  return Charge.create({
    id: uuidv7(),
    contractId: overrides.contractId ?? uuidv7(),
    studentId: overrides.studentId ?? uuidv7(),
    centerId: overrides.centerId ?? uuidv7(),
    kind,
    reference: overrides.reference ?? `installment:${String(installmentNumber ?? 1)}`,
    installmentNumber,
    period: dueDate.period,
    amount: Money.fromCents(overrides.amountCents ?? 337_50),
    dueDate,
    now: NOW,
  });
}

export function aMandate(overrides: { contractId?: string; studentId?: string } = {}) {
  return PaymentMandate.sign({
    id: uuidv7(),
    contractId: overrides.contractId ?? uuidv7(),
    studentId: overrides.studentId ?? uuidv7(),
    iban: unwrap(Iban.create(STUDENT_IBAN)),
    now: NOW,
  });
}

export function aDeclaration(
  overrides: { contractId?: string; period?: string; incomeCents?: number } = {},
) {
  return IncomeDeclaration.declare({
    id: uuidv7(),
    contractId: overrides.contractId ?? uuidv7(),
    studentId: uuidv7(),
    period: overrides.period ?? '2026-10',
    grossMonthlyIncome: Money.fromCents(overrides.incomeCents ?? 2_000_00),
    source: 'self',
    now: NOW,
  });
}
