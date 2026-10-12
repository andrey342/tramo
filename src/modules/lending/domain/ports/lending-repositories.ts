import { type Contract } from '../model/contract';
import { type Disbursement } from '../model/disbursement';
import { type FinancingPlan } from '../model/financing-plan';

export const CONTRACT_REPOSITORY = Symbol('CONTRACT_REPOSITORY');
export const DISBURSEMENT_REPOSITORY = Symbol('DISBURSEMENT_REPOSITORY');
export const FINANCING_PLAN_REPOSITORY = Symbol('FINANCING_PLAN_REPOSITORY');

export interface ContractRepository {
  findById(id: string): Promise<Contract | null>;
  // One contract per application: the offer it was drawn up from.
  findByApplicationId(applicationId: string): Promise<Contract | null>;
  findByEnvelopeId(envelopeId: string): Promise<Contract | null>;
  save(contract: Contract): Promise<void>;
}

export interface DisbursementRepository {
  findById(id: string): Promise<Disbursement | null>;
  findByContractId(contractId: string): Promise<Disbursement | null>;
  save(disbursement: Disbursement): Promise<void>;
}

export interface FinancingPlanRepository {
  findById(id: string): Promise<FinancingPlan | null>;
  findByContractId(contractId: string): Promise<FinancingPlan | null>;
  save(plan: FinancingPlan): Promise<void>;
}
