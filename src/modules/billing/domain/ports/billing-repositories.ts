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
  // Ids of scheduled charges due on or before `asOf`, to collect.
  findDueIds(asOf: CalendarDate, limit: number, afterId: string | null): Promise<string[]>;
  // Ids of charges dunning still acts on: not paid, written off or cancelled.
  findUnsettledIds(limit: number, afterId: string | null): Promise<string[]>;
  // Scheduled charges of a contract, cancelled when its plan ends.
  findScheduledIds(contractId: string): Promise<string[]>;
  // Whether a contract has charges in arrears other than `exceptChargeId`.
  hasOtherChargesInArrears(contractId: string, exceptChargeId: string): Promise<boolean>;
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
