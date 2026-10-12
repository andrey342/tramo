import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { ActivateContractHandler } from './application/commands/activate-contract.command';
import { AssessIsaPeriodHandler } from './application/commands/assess-isa-period.command';
import { CheckDisbursementSettlementHandler } from './application/commands/check-disbursement-settlement.command';
import { CompleteContractHandler } from './application/commands/complete-contract.command';
import { DrawUpContractHandler } from './application/commands/draw-up-contract.command';
import { ExecuteDisbursementHandler } from './application/commands/execute-disbursement.command';
import { OpenFinancingPlanHandler } from './application/commands/open-financing-plan.command';
import { ReconcileDisbursementHandler } from './application/commands/reconcile-disbursement.command';
import { RecordSignatureEventHandler } from './application/commands/record-signature-event.command';
import { RequestDisbursementHandler } from './application/commands/request-disbursement.command';
import { RequestPayoffHandler } from './application/commands/request-payoff.command';
import { RetryDisbursementHandler } from './application/commands/retry-disbursement.command';
import { SendContractForSignatureHandler } from './application/commands/send-contract-for-signature.command';
import {
  BANK_TRANSFER_PROVIDER,
  CONTRACT_QUERIES,
  CONTRACTING_DIRECTORY,
  E_SIGNATURE_PROVIDER,
} from './application/ports/lending-ports';
import { FindContractHandler } from './application/queries/find-contract.query';
import { GetContractDocumentHandler } from './application/queries/get-contract-document.query';
import { GetContractScheduleHandler } from './application/queries/get-contract-schedule.query';
import { GetContractHandler } from './application/queries/get-contract.query';
import { GetPayoffQuoteHandler } from './application/queries/get-payoff-quote.query';
import { ListBillablePlansHandler } from './application/queries/list-billable-plans.query';
import { ListContractsHandler } from './application/queries/list-contracts.query';
import { ListDisbursementsHandler } from './application/queries/list-disbursements.query';
import { CONTRACT_REPOSITORY, DISBURSEMENT_REPOSITORY, FINANCING_PLAN_REPOSITORY } from './domain';
import { CatalogContractingDirectory } from './infrastructure/adapters/catalog-contracting-directory';
import { SimulatedBankTransferProvider } from './infrastructure/adapters/simulated-bank-transfer-provider';
import { SimulatedESignatureProvider } from './infrastructure/adapters/simulated-esignature-provider';
import {
  ActivateOnDisbursementSettled,
  CheckSettlementOnDisbursementSent,
  CompleteContractOnPlanCompleted,
  DrawUpContractOnOfferAccepted,
  OpenPlanOnContractActivated,
  RequestDisbursementOnContractSigned,
  SendForSignatureOnContractCreated,
  TransferOnDisbursementRequested,
  TransferOnDisbursementRetried,
} from './infrastructure/consumers/contract-saga.consumers';
import { LendingJobs } from './infrastructure/jobs/lending-jobs';
import { DisbursementMapper } from './infrastructure/persistence/lending.mappers';
import {
  ContractOrmEntity,
  DisbursementOrmEntity,
  FinancingPlanOrmEntity,
} from './infrastructure/persistence/lending.orm-entities';
import { TypeOrmContractQueries } from './infrastructure/persistence/typeorm-contract.queries';
import {
  TypeOrmContractRepository,
  TypeOrmDisbursementRepository,
  TypeOrmFinancingPlanRepository,
} from './infrastructure/persistence/typeorm-lending.repositories';

// A simulated e-signature provider signs whatever its callback says and a simulated bank pays
// nobody: lending on them in production would hand out money with no signed contract behind it.
// The process refuses to start instead.
function simulated<T>(config: AppConfig, provider: T): T {
  if (config.env === 'production') {
    throw new Error(
      'LENDING_PROVIDERS is simulated; production needs a real e-signature provider and bank.',
    );
  }
  return provider;
}

// Use cases, persistence and adapters of the lending context. Shared by both processes; the HTTP
// surface lives in LendingHttpModule, which only the api imports, and queue processors in
// LendingWorkerModule, which only the worker imports.
@Module({
  imports: [
    TypeOrmModule.forFeature([ContractOrmEntity, DisbursementOrmEntity, FinancingPlanOrmEntity]),
  ],
  providers: [
    DisbursementMapper,
    { provide: CONTRACT_REPOSITORY, useClass: TypeOrmContractRepository },
    { provide: DISBURSEMENT_REPOSITORY, useClass: TypeOrmDisbursementRepository },
    { provide: FINANCING_PLAN_REPOSITORY, useClass: TypeOrmFinancingPlanRepository },
    { provide: CONTRACT_QUERIES, useClass: TypeOrmContractQueries },
    SimulatedESignatureProvider,
    SimulatedBankTransferProvider,
    CatalogContractingDirectory,
    {
      provide: E_SIGNATURE_PROVIDER,
      inject: [APP_CONFIG, SimulatedESignatureProvider],
      useFactory: simulated,
    },
    {
      provide: BANK_TRANSFER_PROVIDER,
      inject: [APP_CONFIG, SimulatedBankTransferProvider],
      useFactory: simulated,
    },
    { provide: CONTRACTING_DIRECTORY, useExisting: CatalogContractingDirectory },
    SendContractForSignatureHandler,
    DrawUpContractHandler,
    RecordSignatureEventHandler,
    RequestDisbursementHandler,
    ExecuteDisbursementHandler,
    CheckDisbursementSettlementHandler,
    RetryDisbursementHandler,
    ReconcileDisbursementHandler,
    ActivateContractHandler,
    OpenFinancingPlanHandler,
    CompleteContractHandler,
    RequestPayoffHandler,
    GetContractHandler,
    ListContractsHandler,
    GetContractScheduleHandler,
    GetPayoffQuoteHandler,
    GetContractDocumentHandler,
    ListDisbursementsHandler,
    FindContractHandler,
    ListBillablePlansHandler,
    AssessIsaPeriodHandler,
    LendingJobs,
    DrawUpContractOnOfferAccepted,
    SendForSignatureOnContractCreated,
    RequestDisbursementOnContractSigned,
    TransferOnDisbursementRequested,
    TransferOnDisbursementRetried,
    CheckSettlementOnDisbursementSent,
    ActivateOnDisbursementSettled,
    OpenPlanOnContractActivated,
    CompleteContractOnPlanCompleted,
  ],
  exports: [CONTRACT_REPOSITORY, DISBURSEMENT_REPOSITORY, FINANCING_PLAN_REPOSITORY],
})
export class LendingModule {}
