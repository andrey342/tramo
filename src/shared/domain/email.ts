import { InvalidValueError } from './domain-error';
import { err, ok, type Result } from './result';
import { ValueObject } from './value-object';

// Deliberately simple: an address is proven by delivering mail to it, not by a perfect regex.
// No whitespace, and none of the characters that make an address a list or a display name
// (,;<>"()[]\:), so a stored address is always one mailbox wherever it is used.
const EMAIL_PATTERN = /^[^\s@,;<>"()[\]\\:]+@[^\s@,;<>"()[\]\\:]+\.[^\s@,;<>"()[\]\\:]+$/;
const MAX_LENGTH = 254;

export class Email extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  // The form addresses are stored and looked up in. Lookups of possibly invalid input (sign-in)
  // use it directly, so they always match what create() stored.
  static normalize(raw: string): string {
    return raw.trim().toLowerCase();
  }

  static create(raw: string): Result<Email, InvalidValueError> {
    const value = Email.normalize(raw);
    if (value.length > MAX_LENGTH || !EMAIL_PATTERN.test(value)) {
      return err(new InvalidValueError('email', 'Email address is not valid.'));
    }
    return ok(new Email(value));
  }

  // An address read back from storage, as it was accepted then: the rule may have tightened
  // since (list characters), and a stored user must still sign in and be written to.
  static reconstitute(stored: string): Email {
    return new Email(stored);
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.value;
  }
}
