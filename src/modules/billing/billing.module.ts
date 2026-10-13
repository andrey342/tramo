import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { CancelOpenChargesHandler } from './application/commands/cancel-open-charges.command';
import { CollectDueChargesHandler } from './application/commands/collect-due-charges.command';
import { CollectWaitingChargesHandler } from './application/commands/collect-waiting-charges.command';
import { CreatePayoffChargeHandler } from './application/commands/create-payoff-charge.command';
import { DeclareIncomeHandler } from './application/commands/declare-income.command';
import { ExecuteChargeCollectionHandler } from './application/commands/execute-charge-collection.command';
import {
  RunBillingNowHandler,
  RunDunningNowHandler,
} from './application/commands/ops-runs.command';
import { RecordPaymentResultHandler } from './application/commands/record-payment-result.command';
import { RetryChargeHandler } from './application/commands/retry-charge.command';
import { RunBillingCycleHandler } from './application/commands/run-billing-cycle.command';
import { RunDunningHandler } from './application/commands/run-dunning.command';
import { SendDeclarationRemindersHandler } from './application/commands/send-declaration-reminders.command';
import { SignMandateHandler } from './application/commands/sign-mandate.command';
import {
  BILLING_QUERIES,
  DECLARATION_REMINDERS,
  PAYMENT_GATEWAY,
  REPAYMENT_PLANS,
} from './application/ports/billing-ports';
import { GetStatementHandler } from './application/queries/get-statement.query';
import { ListChargesHandler } from './application/queries/list-charges.query';
import {
  CHARGE_REPOSITORY,
  INCOME_DECLARATION_REPOSITORY,
  PAYMENT_MANDATE_REPOSITORY,
} from './domain';
import { LendingRepaymentPlans } from './infrastructure/adapters/lending-repayment-plans';
import {
  PSP_CALLBACK_SCHEDULER,
  SimulatedPaymentGateway,
} from './infrastructure/adapters/simulated-payment-gateway';
import { QueuedPspCallbacks } from './infrastructure/adapters/simulated-psp-callbacks';
import {
  CancelChargesOnContractDefaulted,
  CancelChargesOnPlanCompleted,
  ChargeOnPayoffRequested,
  RebillOnPayoffWithdrawn,
  CollectOnChargeSubmitted,
  CollectOnMandateSigned,
  LedgerOnChargeCancelled,
  LedgerOnChargeCreated,
  LedgerOnChargePaid,
  LedgerOnChargeWrittenOff,
} from './infrastructure/consumers/billing.consumers';
import { BillingCycleJobs, CollectionJobs } from './infrastructure/jobs/billing-jobs';
import { PaymentMandateMapper } from './infrastructure/persistence/billing.mappers';
import {
  ChargeOrmEntity,
  IncomeDeclarationOrmEntity,
  LedgerEntryOrmEntity,
  PaymentMandateOrmEntity,
} from './infrastructure/persistence/billing.orm-entities';
import {
  LedgerWriter,
  TypeOrmBillingQueries,
  TypeOrmDeclarationReminders,
} from './infrastructure/persistence/typeorm-billing.queries';
import {
  TypeOrmChargeRepository,
  TypeOrmIncomeDeclarationRepository,
  TypeOrmPaymentMandateRepository,
} from './infrastructure/persistence/typeorm-billing.repositories';

// A simulated provider collects nothing: billing on it in production would mark charges paid that
// no bank ever debited. The process refuses to start instead.
function simulated(config: AppConfig, gateway: SimulatedPaymentGateway): SimulatedPaymentGateway {
  if (config.env === 'production') {
    throw new Error('PAYMENT_PROVIDER is simulated; production needs a real payment provider.');
  }
  return gateway;
}

// Use cases, persistence and adapters of the billing context. Shared by both processes; the HTTP
// surface lives in BillingHttpModule, which only the api imports, and queue processors in
// BillingWorkerModule, which only the worker imports.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChargeOrmEntity,
      PaymentMandateOrmEntity,
      IncomeDeclarationOrmEntity,
      LedgerEntryOrmEntity,
    ]),
  ],
  providers: [
    PaymentMandateMapper,
    { provide: CHARGE_REPOSITORY, useClass: TypeOrmChargeRepository },
    { provide: PAYMENT_MANDATE_REPOSITORY, useClass: TypeOrmPaymentMandateRepository },
    { provide: INCOME_DECLARATION_REPOSITORY, useClass: TypeOrmIncomeDeclarationRepository },
    { provide: BILLING_QUERIES, useClass: TypeOrmBillingQueries },
    { provide: DECLARATION_REMINDERS, useClass: TypeOrmDeclarationReminders },
    LedgerWriter,
    LendingRepaymentPlans,
    { provide: REPAYMENT_PLANS, useExisting: LendingRepaymentPlans },
    QueuedPspCallbacks,
    { provide: PSP_CALLBACK_SCHEDULER, useExisting: QueuedPspCallbacks },
    SimulatedPaymentGateway,
    {
      provide: PAYMENT_GATEWAY,
      inject: [APP_CONFIG, SimulatedPaymentGateway],
      useFactory: simulated,
    },
    SignMandateHandler,
    DeclareIncomeHandler,
    RunBillingCycleHandler,
    CollectDueChargesHandler,
    CollectWaitingChargesHandler,
    ExecuteChargeCollectionHandler,
    RecordPaymentResultHandler,
    RunDunningHandler,
    RetryChargeHandler,
    CreatePayoffChargeHandler,
    CancelOpenChargesHandler,
    SendDeclarationRemindersHandler,
    RunBillingNowHandler,
    RunDunningNowHandler,
    ListChargesHandler,
    GetStatementHandler,
    CollectionJobs,
    BillingCycleJobs,
    CollectOnChargeSubmitted,
    CollectOnMandateSigned,
    ChargeOnPayoffRequested,
    RebillOnPayoffWithdrawn,
    CancelChargesOnPlanCompleted,
    CancelChargesOnContractDefaulted,
    LedgerOnChargeCreated,
    LedgerOnChargePaid,
    LedgerOnChargeWrittenOff,
    LedgerOnChargeCancelled,
  ],
})
export class BillingModule {}
