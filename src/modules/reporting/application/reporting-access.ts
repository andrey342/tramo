import { type Principal } from '@shared/application';

import { ReportingAccessDeniedError } from '../domain';

const isStaff = (actor: Principal): boolean =>
  actor.kind === 'user' && actor.roles.some((role) => role === 'ops' || role === 'admin');

// A center sees its own portfolio: its admins, and its API keys holding portfolio:read. Staff
// see every center.
export function assertCanSeeCenter(actor: Principal, centerId: string): void {
  if (isStaff(actor)) {
    return;
  }
  if (
    actor.kind === 'user' &&
    actor.roles.includes('center_admin') &&
    actor.centerId === centerId
  ) {
    return;
  }
  if (
    actor.kind === 'api_key' &&
    actor.centerId === centerId &&
    actor.scopes.includes('portfolio:read')
  ) {
    return;
  }
  throw new ReportingAccessDeniedError();
}

export function assertStaff(actor: Principal): void {
  if (!isStaff(actor)) {
    throw new ReportingAccessDeniedError();
  }
}
