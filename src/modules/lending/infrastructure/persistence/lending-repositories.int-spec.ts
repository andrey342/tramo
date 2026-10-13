import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { ConcurrentModificationError } from '@shared/domain';
import { CoreModule } from '@shared/infrastructure/core.module';

import { lendingRepositoriesContract } from '../../../../../test/contracts/lending-repositories.contract';
import {
  aContractSentForSignature,
  anActiveContract,
  LATER,
} from '../../../../../test/factories/lending';
import { CONTRACT_QUERIES } from '../../application/ports/lending-ports';
import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  DISBURSEMENT_REPOSITORY,
  FINANCING_PLAN_REPOSITORY,
} from '../../domain';
import { LendingModule } from '../../lending.module';

describe('lending repositories (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let contracts: ContractRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), LendingModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    contracts = app.get(CONTRACT_REPOSITORY);
  });

  afterAll(async () => {
    await app.close();
  });

  lendingRepositoriesContract('TypeORM', () => ({
    contracts: app.get(CONTRACT_REPOSITORY),
    disbursements: app.get(DISBURSEMENT_REPOSITORY),
    plans: app.get(FINANCING_PLAN_REPOSITORY),
    queries: app.get(CONTRACT_QUERIES),
    run: (work) => uow.run(work),
  }));

  it('should refuse to save over a newer version', async () => {
    const contract = aContractSentForSignature();
    await uow.run(() => contracts.save(contract));
    const one = await uow.run(() => contracts.findById(contract.id));
    const other = await uow.run(() => contracts.findById(contract.id));
    one?.cancel('signature_declined', LATER);
    await uow.run(() => contracts.save(one!));
    other?.cancel('signature_expired', LATER);

    await expect(uow.run(() => contracts.save(other!))).rejects.toThrow(
      ConcurrentModificationError,
    );
  });

  it('should keep the start day as a date and the terms as a document of their kind', async () => {
    const contract = anActiveContract();
    await uow.run(() => contracts.save(contract));

    const [row] = await app
      .get(DataSource)
      .query<{ activated_on: string; kind: string }[]>(
        `SELECT activated_on::text, product_terms ->> 'kind' AS kind FROM lending.contracts WHERE id = $1`,
        [contract.id],
      );

    expect(row).toEqual({ activated_on: '2026-10-12', kind: 'installments' });
  });

  it('should refuse at the database a signed contract without its signature', async () => {
    const contract = anActiveContract();
    await uow.run(() => contracts.save(contract));

    await expect(
      app
        .get(DataSource)
        .query(`UPDATE lending.contracts SET signed_at = NULL WHERE id = $1`, [contract.id]),
    ).rejects.toThrow(/ck_lending_contracts_signature_by_status/);
  });

  // Only a contract cancelled because its disbursement failed was signed.
  it('should refuse at the database a signing time on a contract the student declined', async () => {
    const contract = aContractSentForSignature();
    contract.cancel('signature_declined', LATER);
    await uow.run(() => contracts.save(contract));

    await expect(
      app
        .get(DataSource)
        .query(`UPDATE lending.contracts SET signed_at = now() WHERE id = $1`, [contract.id]),
    ).rejects.toThrow(/ck_lending_contracts_signature_by_status/);
  });
});
