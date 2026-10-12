import { Module } from '@nestjs/common';

import { CancelScheduledChargesHandler } from './application/commands/cancel-scheduled-charges.command';
import { CollectDueChargesHandler } from './application/commands/collect-due-charges.command';
import { CreatePayoffChargeHandler } from './application/commands/create-payoff-charge.command';
import { DeclareIncomeHandler } from './application/commands/declare-income.command';
import { ExecuteChargeCollectionHandler } from './application/commands/execute-charge-collection.command';
import { RecordPaymentResultHandler } from './application/commands/record-payment-result.command';
import { RetryChargeHandler } from './application/commands/retry-charge.command';
import { RunBillingCycleHandler } from './application/commands/run-billing-cycle.command';
import { RunDunningHandler } from './application/commands/run-dunning.command';
import { SendDeclarationRemindersHandler } from './application/commands/send-declaration-reminders.command';
import { SignMandateHandler } from './application/commands/sign-mandate.command';
import { GetStatementHandler } from './application/queries/get-statement.query';
import { ListChargesHandler } from './application/queries/list-charges.query';
import { LendingRepaymentPlans } from './infrastructure/adapters/lending-repayment-plans';
import { SimulatedPaymentGateway } from './infrastructure/adapters/simulated-payment-gateway';

// Use cases, persistence and adapters of the billing context. Shared by both processes; the HTTP
// surface lives in BillingHttpModule, which only the api imports, and queue processors in
// BillingWorkerModule, which only the worker imports.
@Module({
  providers: [
    SignMandateHandler,
    DeclareIncomeHandler,
    RunBillingCycleHandler,
    CollectDueChargesHandler,
    ExecuteChargeCollectionHandler,
    RecordPaymentResultHandler,
    RunDunningHandler,
    RetryChargeHandler,
    CreatePayoffChargeHandler,
    CancelScheduledChargesHandler,
    SendDeclarationRemindersHandler,
    ListChargesHandler,
    GetStatementHandler,
    LendingRepaymentPlans,
    SimulatedPaymentGateway,
  ],
  exports: [],
})
export class BillingModule {}
