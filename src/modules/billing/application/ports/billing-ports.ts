import { type CursorPage, type PageRequest } from '@shared/application';
import { type Money } from '@shared/domain';

import { type ChargeDto, type LedgerEntryDto } from '../dto/billing.dto';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
export const REPAYMENT_PLANS = Symbol('REPAYMENT_PLANS');
export const BILLING_QUERIES = Symbol('BILLING_QUERIES');
export const DECLARATION_REMINDERS = Symbol('DECLARATION_REMINDERS');

export interface CollectionRequest {
  // Same key, same collection: a repeated call never debits twice.
  readonly idempotencyKey: string;
  readonly amount: Money;
  readonly mandateReference: string;
  readonly debtorIban: string;
  readonly description: string;
}

// The payment service provider debiting students' accounts under their SEPA mandates. It accepts
// a request at once and reports the outcome later (POST /webhooks/psp), echoing the key.
export interface PaymentGateway {
  collect(request: CollectionRequest): Promise<{ readonly paymentId: string }>;
}

export interface RepaidContract {
  readonly id: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly product: 'installments' | 'isa';
  readonly status: string;
  // ISA only: the first month of income not assessed yet (YYYY-MM).
  readonly nextIsaPeriod: string | null;
}

export interface BillablePlan {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly kind: 'installments' | 'isa';
  readonly unpaidInstallments: readonly {
    readonly number: number;
    readonly dueDate: string;
    readonly totalCents: number;
  }[];
  readonly nextIsaPeriod: string | null;
}

// `planEnded`: the month assessed ended the plan; there is nothing more to assess.
export type IsaAssessment = (
  | { readonly outcome: 'charge'; readonly amountCents: number }
  | { readonly outcome: 'paused' | 'not_started' | 'ended' }
) & { readonly planEnded: boolean };

// What billing reads from lending, through its public queries and command.
export interface RepaymentPlans {
  findContract(contractId: string): Promise<RepaidContract | null>;
  // Plans being repaid (none with a payoff in collection), a page at a time in contract id
  // order; one contract only when given.
  billablePlans(
    afterContractId: string | null,
    limit: number,
    contractId?: string | null,
  ): Promise<readonly BillablePlan[]>;
  // The principal of each instalment of a loan not paid yet, whatever the plan's state; null for
  // an ISA.
  unpaidPrincipal(
    contractId: string,
  ): Promise<readonly { readonly number: number; readonly principalCents: number }[] | null>;
  // Lending's ISA rules applied to the income declared for a month (null if none was).
  assessIsaPeriod(
    contractId: string,
    period: string,
    declaredIncomeCents: number | null,
  ): Promise<IsaAssessment>;
}

export interface BillingQueries {
  listCharges(contractId: string, page: PageRequest): Promise<CursorPage<ChargeDto>>;
  // Bounded by design: one contract has a few dozen charges, each with two entries at most.
  ledger(contractId: string): Promise<readonly Omit<LedgerEntryDto, 'balanceCents'>[]>;
}

// One reminder per contract and month: true when this one is the first.
export interface DeclarationReminders {
  record(contractId: string, period: string): Promise<boolean>;
}
