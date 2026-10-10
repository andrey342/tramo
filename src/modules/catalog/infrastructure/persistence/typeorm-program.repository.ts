import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { AggregatePersister } from '@shared/infrastructure/database/aggregate-persister';

import { type Program, type ProgramRepository } from '../../domain';

import { ProgramMapper } from './catalog.mappers';
import { ProgramOrmEntity } from './program.orm-entity';

@Injectable()
export class TypeOrmProgramRepository implements ProgramRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<Program | null> {
    const row = await this.txHost.tx.findOneBy(ProgramOrmEntity, { id });
    return row ? ProgramMapper.toDomain(row) : null;
  }

  save(program: Program): Promise<void> {
    return this.persister.save(ProgramOrmEntity, program, ProgramMapper.toRow(program), 'Program');
  }
}
