import { DomainError } from '@shared/domain';

export class ReportingAccessDeniedError extends DomainError {
  readonly code = 'reporting_access_denied';
  readonly category = 'forbidden';

  constructor() {
    super('You cannot see these figures.');
  }
}
