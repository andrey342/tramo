import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { type EntityTarget, type ObjectLiteral } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { EVENT_BUS, type EventBus } from '@shared/application';
import { type AggregateRoot, ConcurrentModificationError } from '@shared/domain';

export interface VersionedRow extends ObjectLiteral {
  id: string;
  version: number;
}

// The one way repositories write an aggregate:
// - insert on first save, otherwise "UPDATE ... WHERE id = :id AND version = :loaded" so a
//   concurrent change is detected instead of silently overwritten (optimistic locking);
// - pending domain events go to the outbox in the same transaction.
@Injectable()
export class AggregatePersister {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async save<R extends VersionedRow>(
    target: EntityTarget<R>,
    aggregate: AggregateRoot,
    row: Omit<R, 'version'>,
    entityName: string,
  ): Promise<void> {
    const loadedVersion = aggregate.version;
    const nextVersion = loadedVersion + 1;
    const values = { ...row, version: nextVersion } as unknown as QueryDeepPartialEntity<R>;
    if (loadedVersion === 0) {
      await this.txHost.tx.insert(target, values);
    } else {
      const result = await this.txHost.tx.update(
        target,
        { id: aggregate.id, version: loadedVersion },
        values,
      );
      if (result.affected !== 1) {
        throw new ConcurrentModificationError(entityName, aggregate.id);
      }
    }
    aggregate.markPersisted(nextVersion);
    await this.events.publish(aggregate.pullEvents());
  }
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const driverError = (error as { driverError?: { code?: unknown; constraint?: unknown } })
    .driverError;
  return driverError?.code === '23505' && driverError.constraint === constraint;
}
