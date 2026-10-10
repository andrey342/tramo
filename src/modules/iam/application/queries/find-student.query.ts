import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { Email } from '@shared/domain';

import { USER_REPOSITORY, type UserRepository } from '../../domain';
import { FindStudentQuery, type StudentSummaryDto } from '../dto/student-lookup';

// Only students: a center must not start an application in the name of staff or another center.
@QueryHandler(FindStudentQuery)
export class FindStudentHandler implements IQueryHandler<FindStudentQuery> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(query: FindStudentQuery): Promise<StudentSummaryDto | null> {
    const email = Email.create(query.email);
    if (!email.ok) {
      return null;
    }
    const user = await this.users.findByEmail(email.value.value);
    return user?.hasRole('student') ? { userId: user.id } : null;
  }
}
