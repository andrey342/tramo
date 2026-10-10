import { type Principal } from '@shared/application';

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

// Staff see every center; a center sees itself, through its admins or its API keys.
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
  if (actor.kind === 'api_key' && actor.centerId === centerId) {
    return;
  }
  throw new CenterAccessDeniedError(centerId);
}
