import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '@modules/lending/domain';
import { LendingModule } from '@modules/lending/lending.module';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { LendingRepaymentPlans } from '../../src/modules/billing/infrastructure/adapters/lending-repayment-plans';
import { repaymentPlansContract } from '../contracts/repayment-plans.contract';
import { anActiveContract, anIsa, aPlan, LATER } from '../factories/lending';

// Crosses two modules (the adapter of billing, the queries and command of lending), so it lives
// outside both.
describe('LendingRepaymentPlans (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), LendingModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  repaymentPlansContract('LendingRepaymentPlans over the query and command buses', async () => {
    const installments = anActiveContract();
    const isa = anActiveContract({
      studentId: installments.studentId,
      terms: { product: anIsa() },
    });
    const installmentsPlan = aPlan({ contractId: installments.id });
    installmentsPlan.recordInstallmentPaid(1, LATER);
    const contracts = app.get<ContractRepository>(CONTRACT_REPOSITORY);
    const plans = app.get<FinancingPlanRepository>(FINANCING_PLAN_REPOSITORY);
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await contracts.save(installments);
      await contracts.save(isa);
      await plans.save(installmentsPlan);
      await plans.save(aPlan({ contractId: isa.id, product: anIsa(), activatedOn: '2026-01-05' }));
    });
    return {
      plans: new LendingRepaymentPlans(app.get(QueryBus), app.get(CommandBus)),
      installmentsContractId: installments.id,
      studentId: installments.studentId,
      isaContractId: isa.id,
    };
  });
});
