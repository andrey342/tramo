import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FindStudentQuery } from '@modules/iam/application/dto/student-lookup';

import { type StudentDirectory } from '../../application/ports/origination-ports';

// Asks the iam module through its public query, never through its tables (ADR 008).
@Injectable()
export class IamStudentDirectory implements StudentDirectory {
  constructor(private readonly queries: QueryBus) {}

  async findStudentId(email: string): Promise<string | null> {
    return (await this.queries.execute(new FindStudentQuery(email)))?.userId ?? null;
  }
}
