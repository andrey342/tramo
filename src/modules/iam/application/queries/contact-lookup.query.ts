import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { type User, USER_REPOSITORY, type UserRepository } from '../../domain';
import {
  FindUserContactQuery,
  ListCenterContactsQuery,
  type UserContactDto,
} from '../dto/contact-lookup';

const contact = (user: User): UserContactDto => ({ userId: user.id, email: user.email.value });

@QueryHandler(FindUserContactQuery)
export class FindUserContactHandler implements IQueryHandler<FindUserContactQuery> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(query: FindUserContactQuery): Promise<UserContactDto | null> {
    const user = await this.users.findById(query.userId);
    return user?.canSignIn ? contact(user) : null;
  }
}

@QueryHandler(ListCenterContactsQuery)
export class ListCenterContactsHandler implements IQueryHandler<ListCenterContactsQuery> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(query: ListCenterContactsQuery): Promise<readonly UserContactDto[]> {
    const users = await this.users.listByCenter(query.centerId);
    return users.filter((user) => user.canSignIn && user.hasRole('center_admin')).map(contact);
  }
}
