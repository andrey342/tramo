import { type Principal } from '@shared/application';
import { type ApiKeyScope, EntityNotFoundError } from '@shared/domain';

import { type FinancingApplication, type FinancingApplicationRepository } from '../domain';

// Tramo staff: ops analysts and admins.
export const isStaff = (actor: Principal): boolean =>
  actor.kind === 'user' && actor.roles.some((role) => role === 'ops' || role === 'admin');

const isApplicant = (actor: Principal, application: FinancingApplication): boolean =>
  actor.kind === 'user' &&
  actor.roles.includes('student') &&
  actor.userId === application.applicantId;

// The training center the program belongs to: its admins, and its API keys with one of `scopes`.
function isCenterOf(actor: Principal, centerId: string, scopes: readonly ApiKeyScope[]): boolean {
  if (actor.kind === 'user') {
    return actor.roles.includes('center_admin') && actor.centerId === centerId;
  }
  return (
    actor.kind === 'api_key' &&
    actor.centerId === centerId &&
    actor.scopes.some((scope) => scopes.includes(scope))
  );
}

// Status and program: the student, staff and the center. Routes open to API keys check scopes
// in the guard too; checking them here keeps the rule in one place.
export const canView = (actor: Principal, application: FinancingApplication): boolean =>
  isStaff(actor) ||
  isApplicant(actor, application) ||
  isCenterOf(actor, application.centerId, ['applications:read', 'applications:write']);

// Personal data and the decision explanation: the student and staff, not the center.
export const canSeePersonalData = (actor: Principal, application: FinancingApplication): boolean =>
  isStaff(actor) || isApplicant(actor, application);

// A draft is completed by the student, or by the center's integration when it started it (its
// program and product only: the personal data comes from the student).
export const canEditDraft = (actor: Principal, application: FinancingApplication): boolean =>
  isApplicant(actor, application) ||
  (application.origin === 'center' &&
    actor.kind === 'api_key' &&
    isCenterOf(actor, application.centerId, ['applications:write']));

// Submitting starts checks of the student's identity, employment and credit: only the student
// consents to that. Cancelling and accepting the offer are the student's calls too.
export const actsForApplicant = (actor: Principal, application: FinancingApplication): boolean =>
  isApplicant(actor, application);

// Applications the caller may not see are reported as missing, not forbidden.
export async function findVisibleApplication(
  applications: FinancingApplicationRepository,
  actor: Principal,
  applicationId: string,
): Promise<FinancingApplication> {
  const application = await applications.findById(applicationId);
  if (!application || !canView(actor, application)) {
    throw new EntityNotFoundError('FinancingApplication', applicationId);
  }
  return application;
}
