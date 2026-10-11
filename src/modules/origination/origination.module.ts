import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { AcceptOfferHandler } from './application/commands/accept-offer.command';
import { CancelApplicationHandler } from './application/commands/cancel-application.command';
import { DecideApplicationHandler } from './application/commands/decide-application.command';
import { ExpireApplicationHandler } from './application/commands/expire-application.command';
import { ReviseRiskPolicyHandler } from './application/commands/revise-risk-policy.command';
import { RunVerificationHandler } from './application/commands/run-verification.command';
import { ScoreApplicationHandler } from './application/commands/score-application.command';
import { StartApplicationHandler } from './application/commands/start-application.command';
import { StartVerificationHandler } from './application/commands/start-verification.command';
import { SubmitApplicationHandler } from './application/commands/submit-application.command';
import { UpdateApplicationDraftHandler } from './application/commands/update-application-draft.command';
import {
  CREDIT_BUREAU,
  EMPLOYMENT_HISTORY_PROVIDER,
  KYC_PROVIDER,
} from './application/ports/origination-ports';
import { GetApplicationDecisionHandler } from './application/queries/get-application-decision.query';
import { GetApplicationHandler } from './application/queries/get-application.query';
import { GetCurrentRiskPolicyHandler } from './application/queries/get-current-risk-policy.query';
import { GetReviewQueueHandler } from './application/queries/get-review-queue.query';
import { ListApplicationsHandler } from './application/queries/list-applications.query';
import { SimulatedCreditBureau } from './infrastructure/adapters/simulated-credit-bureau';
import { SimulatedEmploymentHistoryProvider } from './infrastructure/adapters/simulated-employment-history-provider';
import { SimulatedKycProvider } from './infrastructure/adapters/simulated-kyc-provider';
import {
  SIMULATED_LATENCY,
  type SimulatedLatency,
} from './infrastructure/adapters/simulated-providers';

// Use cases, persistence and adapters of the origination context. Shared by both processes; the HTTP
// surface lives in OriginationHttpModule, which only the api imports, and queue processors in
// OriginationWorkerModule, which only the worker imports.
@Module({
  providers: [
    StartApplicationHandler,
    ReviseRiskPolicyHandler,
    UpdateApplicationDraftHandler,
    SubmitApplicationHandler,
    CancelApplicationHandler,
    AcceptOfferHandler,
    DecideApplicationHandler,
    StartVerificationHandler,
    RunVerificationHandler,
    ScoreApplicationHandler,
    ExpireApplicationHandler,
    GetApplicationHandler,
    ListApplicationsHandler,
    GetApplicationDecisionHandler,
    GetReviewQueueHandler,
    GetCurrentRiskPolicyHandler,
    {
      provide: SIMULATED_LATENCY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SimulatedLatency => config.verification.simulatedLatency,
    },
    { provide: KYC_PROVIDER, useClass: SimulatedKycProvider },
    { provide: EMPLOYMENT_HISTORY_PROVIDER, useClass: SimulatedEmploymentHistoryProvider },
    { provide: CREDIT_BUREAU, useClass: SimulatedCreditBureau },
  ],
  exports: [],
})
export class OriginationModule {}
