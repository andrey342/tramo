import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type UnitOfWork } from '@shared/application';

// The transaction lives in async-local storage, so repositories reach it through the same
// TransactionHost without it being passed around. Propagation is "required": a nested run joins
// the outer transaction.
@Injectable()
export class ClsUnitOfWork implements UnitOfWork {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.txHost.withTransaction(work);
  }
}
