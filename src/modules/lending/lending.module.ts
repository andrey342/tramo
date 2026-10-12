import { Module } from '@nestjs/common';

import { ActivateContractHandler } from './application/commands/activate-contract.command';
import { CheckDisbursementSettlementHandler } from './application/commands/check-disbursement-settlement.command';
import { CompleteContractHandler } from './application/commands/complete-contract.command';
import { DrawUpContractHandler } from './application/commands/draw-up-contract.command';
import { ExecuteDisbursementHandler } from './application/commands/execute-disbursement.command';
import { OpenFinancingPlanHandler } from './application/commands/open-financing-plan.command';
import { RecordSignatureEventHandler } from './application/commands/record-signature-event.command';
import { RequestDisbursementHandler } from './application/commands/request-disbursement.command';
import { RequestPayoffHandler } from './application/commands/request-payoff.command';
import { RetryDisbursementHandler } from './application/commands/retry-disbursement.command';
import { SendContractForSignatureHandler } from './application/commands/send-contract-for-signature.command';
import { GetContractDocumentHandler } from './application/queries/get-contract-document.query';
import { GetContractScheduleHandler } from './application/queries/get-contract-schedule.query';
import { GetContractHandler } from './application/queries/get-contract.query';
import { GetPayoffQuoteHandler } from './application/queries/get-payoff-quote.query';
import { ListContractsHandler } from './application/queries/list-contracts.query';
import { ListDisbursementsHandler } from './application/queries/list-disbursements.query';
import { CatalogContractingDirectory } from './infrastructure/adapters/catalog-contracting-directory';
import { SimulatedBankTransferProvider } from './infrastructure/adapters/simulated-bank-transfer-provider';
import { SimulatedESignatureProvider } from './infrastructure/adapters/simulated-esignature-provider';

// Use cases, persistence and adapters of the lending context. Shared by both processes; the HTTP
// surface lives in LendingHttpModule, which only the api imports, and queue processors in
// LendingWorkerModule, which only the worker imports.
@Module({
  providers: [
    SimulatedESignatureProvider,
    SimulatedBankTransferProvider,
    CatalogContractingDirectory,
    SendContractForSignatureHandler,
    DrawUpContractHandler,
    RecordSignatureEventHandler,
    RequestDisbursementHandler,
    ExecuteDisbursementHandler,
    CheckDisbursementSettlementHandler,
    RetryDisbursementHandler,
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
  ],
  exports: [],
})
export class LendingModule {}
