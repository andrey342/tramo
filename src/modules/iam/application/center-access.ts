import { type Principal } from '@shared/application';

import { CenterAccessDeniedError } from '../domain';

// Tramo admins manage every center; a center admin only manages its own center.
export function assertCanManageCenter(principal: Principal, centerId: string): void {
  if (principal.kind !== 'user') {
    throw new CenterAccessDeniedError(centerId);
  }
  if (principal.roles.includes('admin')) {
    return;
  }
  if (principal.roles.includes('center_admin') && principal.centerId === centerId) {
    return;
  }
  throw new CenterAccessDeniedError(centerId);
}

// Creating center users is reserved to Tramo admins, including for the center's own admins.
export function assertIsAdmin(principal: Principal, centerId: string): void {
  if (principal.kind !== 'user' || !principal.roles.includes('admin')) {
    throw new CenterAccessDeniedError(centerId);
  }
}

export function actorId(principal: Principal): string {
  if (principal.kind !== 'user') {
    throw new Error('Only users act on behalf of a center here.');
  }
  return principal.userId;
}
