import { type Principal } from '@shared/application';

import { NotificationsAccessDeniedError } from '../domain';

const isStaff = (actor: Principal): boolean =>
  actor.kind === 'user' && actor.roles.some((role) => role === 'ops' || role === 'admin');

const isAdminOf = (actor: Principal, centerId: string): boolean =>
  actor.kind === 'user' && actor.roles.includes('center_admin') && actor.centerId === centerId;

// A center's webhook is its own: its admins configure it and see what was delivered. Staff see
// and redeliver (support), and only the center sets where its events go.
export function assertCanConfigure(actor: Principal, centerId: string): void {
  if (!isAdminOf(actor, centerId)) {
    throw new NotificationsAccessDeniedError();
  }
}

export function assertCanView(actor: Principal, centerId: string): void {
  if (!isAdminOf(actor, centerId) && !isStaff(actor)) {
    throw new NotificationsAccessDeniedError();
  }
}
