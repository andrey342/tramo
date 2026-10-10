import { type Principal } from '@shared/application';
import { type ApiKeyScope } from '@shared/domain';

import { CenterAccessDeniedError } from '../domain';

// Background work (event consumers) acts as the system, not as a person.
export type Actor = Principal | 'system';

const isUserWith = (actor: Actor, ...roles: string[]): boolean =>
  actor !== 'system' && actor.kind === 'user' && actor.roles.some((role) => roles.includes(role));

// Registering, suspending and changing the payout account of a center is Tramo's decision.
export function assertIsAdmin(actor: Actor, centerId: string): void {
  if (!isUserWith(actor, 'admin')) {
    throw new CenterAccessDeniedError(centerId);
  }
}

// Asking VIES again is routine operations work.
export function assertCanOperate(actor: Actor, centerId: string): void {
  if (actor !== 'system' && !isUserWith(actor, 'admin', 'ops')) {
    throw new CenterAccessDeniedError(centerId);
  }
}

// Staff see every center; a center sees itself through its admins. API keys are for programs and
// applications, and no scope lets them read the center's own record (fee, payout account).
export function assertCanView(actor: Actor, centerId: string): void {
  if (actor === 'system' || isUserWith(actor, 'admin', 'ops')) {
    return;
  }
  if (
    actor.kind === 'user' &&
    actor.roles.includes('center_admin') &&
    actor.centerId === centerId
  ) {
    return;
  }
  throw new CenterAccessDeniedError(centerId);
}

// Programs are run by their center: its admins, its API keys holding the scope, and Tramo admins.
// API key scopes are checked here too, not only by the guard: routes open to anonymous callers
// (GET /programs/:id) skip the guard's scope check.
function managesPrograms(actor: Actor, centerId: string, scopes: readonly ApiKeyScope[]): boolean {
  if (actor === 'system' || isUserWith(actor, 'admin')) {
    return true;
  }
  if (actor.kind === 'user') {
    return actor.roles.includes('center_admin') && actor.centerId === centerId;
  }
  return (
    actor.kind === 'api_key' &&
    actor.centerId === centerId &&
    actor.scopes.some((scope) => scopes.includes(scope))
  );
}

export function assertCanManagePrograms(actor: Actor, centerId: string): void {
  if (!managesPrograms(actor, centerId, ['programs:write'])) {
    throw new CenterAccessDeniedError(centerId);
  }
}

export function canManagePrograms(actor: Actor, centerId: string): boolean {
  return managesPrograms(actor, centerId, ['programs:write']);
}

// Drafts and archived programs: whoever manages the center's programs, and its keys that may read them.
export function canSeeUnpublishedPrograms(actor: Actor, centerId: string): boolean {
  return managesPrograms(actor, centerId, ['programs:read', 'programs:write']);
}
