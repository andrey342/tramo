import { Query } from '@nestjs/cqrs';

export interface StudentSummaryDto {
  readonly userId: string;
}

// Part of the module's public surface: a training center starts an application on behalf of a
// student it knows by email, and origination asks iam who that is through the query bus.
export class FindStudentQuery extends Query<StudentSummaryDto | null> {
  constructor(readonly email: string) {
    super();
  }
}
