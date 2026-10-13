import { Query } from '@nestjs/cqrs';

export interface UserContactDto {
  readonly userId: string;
  readonly email: string;
}

// Part of the module's public surface: notifications asks iam where to write to a person, through
// the query bus. Only active users have an address to write to.
export class FindUserContactQuery extends Query<UserContactDto | null> {
  constructor(readonly userId: string) {
    super();
  }
}

// The addresses of a training center's active admins, who receive what Tramo tells the center by
// email.
export class ListCenterContactsQuery extends Query<readonly UserContactDto[]> {
  constructor(readonly centerId: string) {
    super();
  }
}
