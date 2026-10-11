import { type FinancingApplication } from '../model/financing-application';
import { type RiskPolicy } from '../model/risk-policy';

export const FINANCING_APPLICATION_REPOSITORY = Symbol('FINANCING_APPLICATION_REPOSITORY');
export const RISK_POLICY_REPOSITORY = Symbol('RISK_POLICY_REPOSITORY');

export interface FinancingApplicationRepository {
  findById(id: string): Promise<FinancingApplication | null>;
  save(application: FinancingApplication): Promise<void>;
  // Ids of applications not final whose status has not changed since `before`, oldest first.
  findStaleIds(before: Date, limit: number): Promise<string[]>;
}

export interface RiskPolicyRepository {
  // The policy in force: the highest version.
  findCurrent(): Promise<RiskPolicy | null>;
  findByVersion(version: number): Promise<RiskPolicy | null>;
  // Versions are never updated; adding one that exists is a conflict.
  add(policy: RiskPolicy): Promise<void>;
}
