import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { type Contract, type ContractRepository } from '../domain';

// Tramo staff: ops analysts and admins.
export const isStaff = (actor: Principal): boolean =>
  actor.kind === 'user' && actor.roles.some((role) => role === 'ops' || role === 'admin');

export const isStudentOf = (actor: Principal, contract: Contract): boolean =>
  actor.kind === 'user' && actor.roles.includes('student') && actor.userId === contract.studentId;

// The training center paid by the contract: its admins, and its API keys reading the portfolio.
export const isCenterOf = (actor: Principal, contract: Contract): boolean =>
  (actor.kind === 'user' &&
    actor.roles.includes('center_admin') &&
    actor.centerId === contract.centerId) ||
  (actor.kind === 'api_key' &&
    actor.centerId === contract.centerId &&
    actor.scopes.includes('portfolio:read'));

// Status, terms and signature: the student, the center and staff.
export const canView = (actor: Principal, contract: Contract): boolean =>
  isStaff(actor) || isStudentOf(actor, contract) || isCenterOf(actor, contract);

// What the center is paid (fee, disbursement): the center and staff, not the student.
export const canSeePayout = (actor: Principal, contract: Contract): boolean =>
  isStaff(actor) || isCenterOf(actor, contract);

// The repayment plan and the document are the student's finances: the student and staff.
export const canSeeRepayment = (actor: Principal, contract: Contract): boolean =>
  isStaff(actor) || isStudentOf(actor, contract);

// Contracts the caller may not see are reported as missing, not forbidden.
export async function findVisibleContract(
  contracts: ContractRepository,
  actor: Principal,
  contractId: string,
  visible: (actor: Principal, contract: Contract) => boolean = canView,
): Promise<Contract> {
  const contract = await contracts.findById(contractId);
  if (!contract || !visible(actor, contract)) {
    throw new EntityNotFoundError('Contract', contractId);
  }
  return contract;
}
