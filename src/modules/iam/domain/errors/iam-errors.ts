import { DomainError } from '@shared/domain';

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'email_already_registered';
  readonly category = 'conflict';

  constructor() {
    super('An account with this email already exists.');
  }
}

// One message for unknown email, wrong password and disabled account, so the response does not
// reveal which accounts exist.
export class InvalidCredentialsError extends DomainError {
  readonly code = 'invalid_credentials';
  readonly category = 'unauthorized';

  constructor() {
    super('Invalid email or password.');
  }
}

export class AccountTemporarilyLockedError extends DomainError {
  readonly code = 'account_temporarily_locked';
  readonly category = 'rate_limited';

  constructor(readonly retryAfterSeconds: number) {
    super(`Too many failed sign-in attempts. Try again in ${retryAfterSeconds} seconds.`, {
      retryAfterSeconds,
    });
  }
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = 'invalid_refresh_token';
  readonly category = 'unauthorized';

  constructor() {
    super('The refresh token is invalid, expired or revoked. Sign in again.');
  }
}

// Sessions belong to users; an API key has none to end (it is revoked instead).
export class SessionOwnerRequiredError extends DomainError {
  readonly code = 'session_owner_required';
  readonly category = 'forbidden';

  constructor() {
    super('Only a signed-in user has sessions to end.');
  }
}

export class InvalidRoleAssignmentError extends DomainError {
  readonly code = 'invalid_role_assignment';
  readonly category = 'rule_violation';
}

export class CenterAccessDeniedError extends DomainError {
  readonly code = 'center_access_denied';
  readonly category = 'forbidden';

  constructor(centerId: string) {
    super(`You cannot manage training center ${centerId}.`, { centerId });
  }
}

// Same code as the catalog's refusal, so clients handle a suspended center one way.
export class CenterSuspendedError extends DomainError {
  readonly code = 'center_suspended';
  readonly category = 'forbidden';

  constructor(centerId: string) {
    super('The training center is suspended; it cannot be given new API keys.', { centerId });
  }
}

export class UserAdministrationDeniedError extends DomainError {
  readonly code = 'user_administration_denied';
  readonly category = 'forbidden';

  constructor() {
    super('Only Tramo admins manage user accounts.');
  }
}

// An admin who disables their own account loses the only session that could undo it.
export class CannotDisableOwnAccountError extends DomainError {
  readonly code = 'cannot_disable_own_account';
  readonly category = 'rule_violation';

  constructor() {
    super('You cannot disable your own account; ask another admin.');
  }
}
