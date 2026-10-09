import { InvalidValueError } from '@shared/domain';

export const PASSWORD_MIN_LENGTH = 12;
// argon2 accepts long inputs, but an unbounded password is a cheap way to burn server CPU.
export const PASSWORD_MAX_LENGTH = 128;

// Length over composition rules (NIST SP 800-63B): long passphrases beat forced symbols.
export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new InvalidValueError(
      'password',
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}
