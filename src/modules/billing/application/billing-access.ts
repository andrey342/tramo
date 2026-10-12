import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { BillingAccessDeniedError } from '../domain';

import { type RepaidContract, type RepaymentPlans } from './ports/billing-ports';

// Tramo staff: ops analysts and admins.
export const isStaff = (actor: Principal): boolean =>
  actor.kind === 'user' && actor.roles.some((role) => role === 'ops' || role === 'admin');

const isStudentOf = (actor: Principal, contract: RepaidContract): boolean =>
  actor.kind === 'user' && actor.roles.includes('student') && actor.userId === contract.studentId;

// A contract's billing is the student's finances: the student and staff see it, nobody else
// (centers see their portfolio in aggregate). Others are told it does not exist.
export async function findVisibleContract(
  plans: RepaymentPlans,
  actor: Principal,
  contractId: string,
): Promise<RepaidContract> {
  const contract = await plans.findContract(contractId);
  if (!contract || !(isStaff(actor) || isStudentOf(actor, contract))) {
    throw new EntityNotFoundError('Contract', contractId);
  }
  return contract;
}

// Mandates and income declarations are the student's own acts: staff may read, not sign.
export async function findOwnContract(
  plans: RepaymentPlans,
  actor: Principal,
  contractId: string,
): Promise<RepaidContract> {
  const contract = await findVisibleContract(plans, actor, contractId);
  if (!isStudentOf(actor, contract)) {
    throw new BillingAccessDeniedError();
  }
  return contract;
}

export function assertStaff(actor: Principal): void {
  if (!isStaff(actor)) {
    throw new BillingAccessDeniedError();
  }
}
