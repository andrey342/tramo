import { type CalendarDate } from '@shared/domain';

import { type Charge } from '../model/charge';
import { type IncomeDeclaration } from '../model/income-declaration';
import { type PaymentMandate } from '../model/payment-mandate';

export const CHARGE_REPOSITORY = Symbol('CHARGE_REPOSITORY');
export const PAYMENT_MANDATE_REPOSITORY = Symbol('PAYMENT_MANDATE_REPOSITORY');
export const INCOME_DECLARATION_REPOSITORY = Symbol('INCOME_DECLARATION_REPOSITORY');

export interface ChargeRepository {
  findById(id: string): Promise<Charge | null>;
  // Charges are unique per contract and reference (`installment:3`, `isa:2026-07`).
  findByReference(contractId: string, reference: string): Promise<Charge | null>;
  // Ids of scheduled charges due on or before `asOf`, to collect; of one contract when given.
  findDueIds(
    asOf: CalendarDate,
    limit: number,
    afterId: string | null,
    contractId?: string | null,
  ): Promise<string[]>;
  // Ids of charges dunning still acts on: not paid, written off or cancelled; of one contract
  // when given.
  findUnsettledIds(
    limit: number,
    afterId: string | null,
    contractId?: string | null,
  ): Promise<string[]>;
  // Charges of a contract not collected and not being collected (scheduled, failed, overdue):
  // what a payoff makes unowed. Oldest first, loaded together.
  findOpen(contractId: string): Promise<Charge[]>;
  // Whether the contract defaults by `asOf` as far as billing knows: a charge written off, or one
  // still owed that reaches its write-off by then (in the same run, before lending hears of it).
  defaultsBy(contractId: string, asOf: CalendarDate): Promise<boolean>;
  // Whether a contract has charges in arrears other than `exceptChargeId`.
  hasOtherChargesInArrears(contractId: string, exceptChargeId: string): Promise<boolean>;
  // Whether a payoff of the contract is scheduled, being collected or paid: it covers what is
  // left, so nothing else of the contract is collected or dunned meanwhile, nor after.
  hasPayoff(contractId: string): Promise<boolean>;
  // Serialises, until the end of the transaction, the billing work on a contract: two payments
  // cannot both see the other still unpaid, and a declaration cannot land in a month the cycle is
  // assessing without it.
  lockContract(contractId: string): Promise<void>;
  save(charge: Charge): Promise<void>;
}

export interface PaymentMandateRepository {
  findById(id: string): Promise<PaymentMandate | null>;
  findActiveByContract(contractId: string): Promise<PaymentMandate | null>;
  save(mandate: PaymentMandate): Promise<void>;
}

export interface IncomeDeclarationRepository {
  findByPeriod(contractId: string, period: string): Promise<IncomeDeclaration | null>;
  save(declaration: IncomeDeclaration): Promise<void>;
}
