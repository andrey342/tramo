import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { AcceptOfferHandler } from './application/commands/accept-offer.command';
import { CancelApplicationHandler } from './application/commands/cancel-application.command';
import { DecideApplicationHandler } from './application/commands/decide-application.command';
import { ExpireApplicationHandler } from './application/commands/expire-application.command';
import { ReviseRiskPolicyHandler } from './application/commands/revise-risk-policy.command';
import { RunVerificationHandler } from './application/commands/run-verification.command';
import { ScoreApplicationHandler } from './application/commands/score-application.command';
import { StartApplicationHandler } from './application/commands/start-application.command';
import { SubmitApplicationHandler } from './application/commands/submit-application.command';
import { UpdateApplicationDraftHandler } from './application/commands/update-application-draft.command';
import {
  APPLICATION_QUERIES,
  CREDIT_BUREAU,
  EMPLOYMENT_HISTORY_PROVIDER,
  KYC_PROVIDER,
  PROGRAM_DIRECTORY,
  STUDENT_DIRECTORY,
} from './application/ports/origination-ports';
import { GetApplicationDecisionHandler } from './application/queries/get-application-decision.query';
import { GetApplicationHandler } from './application/queries/get-application.query';
import { GetCurrentRiskPolicyHandler } from './application/queries/get-current-risk-policy.query';
import { GetReviewQueueHandler } from './application/queries/get-review-queue.query';
import { ListApplicationsHandler } from './application/queries/list-applications.query';
import { FINANCING_APPLICATION_REPOSITORY, RISK_POLICY_REPOSITORY } from './domain';
import { CatalogProgramDirectory } from './infrastructure/adapters/catalog-program-directory';
import { IamStudentDirectory } from './infrastructure/adapters/iam-student-directory';
import { SimulatedCreditBureau } from './infrastructure/adapters/simulated-credit-bureau';
import { SimulatedEmploymentHistoryProvider } from './infrastructure/adapters/simulated-employment-history-provider';
import { SimulatedKycProvider } from './infrastructure/adapters/simulated-kyc-provider';
import {
  SIMULATED_LATENCY,
  type SimulatedLatency,
} from './infrastructure/adapters/simulated-providers';
import {
  ScoreWhenVerified,
  StartVerificationOnSubmit,
} from './infrastructure/consumers/verification-saga.consumers';
import { VerificationJobs } from './infrastructure/jobs/verifications';
import { FinancingApplicationOrmEntity } from './infrastructure/persistence/financing-application.orm-entity';
import { FinancingApplicationMapper } from './infrastructure/persistence/origination.mappers';
import { RiskPolicyOrmEntity } from './infrastructure/persistence/risk-policy.orm-entity';
import { TypeOrmApplicationQueries } from './infrastructure/persistence/typeorm-application.queries';
import { TypeOrmFinancingApplicationRepository } from './infrastructure/persistence/typeorm-financing-application.repository';
import { TypeOrmRiskPolicyRepository } from './infrastructure/persistence/typeorm-risk-policy.repository';

// Use cases, persistence and adapters of the origination context. Shared by both processes; the HTTP
// surface lives in OriginationHttpModule, which only the api imports, and queue processors in
// OriginationWorkerModule, which only the worker imports.
@Module({
  imports: [TypeOrmModule.forFeature([FinancingApplicationOrmEntity, RiskPolicyOrmEntity])],
  providers: [
    FinancingApplicationMapper,
    { provide: FINANCING_APPLICATION_REPOSITORY, useClass: TypeOrmFinancingApplicationRepository },
    { provide: RISK_POLICY_REPOSITORY, useClass: TypeOrmRiskPolicyRepository },
    { provide: APPLICATION_QUERIES, useClass: TypeOrmApplicationQueries },
    StartApplicationHandler,
    ReviseRiskPolicyHandler,
    UpdateApplicationDraftHandler,
    SubmitApplicationHandler,
    CancelApplicationHandler,
    AcceptOfferHandler,
    DecideApplicationHandler,
    RunVerificationHandler,
    ScoreApplicationHandler,
    ExpireApplicationHandler,
    GetApplicationHandler,
    ListApplicationsHandler,
    GetApplicationDecisionHandler,
    GetReviewQueueHandler,
    GetCurrentRiskPolicyHandler,
    IamStudentDirectory,
    CatalogProgramDirectory,
    { provide: STUDENT_DIRECTORY, useExisting: IamStudentDirectory },
    { provide: PROGRAM_DIRECTORY, useExisting: CatalogProgramDirectory },
    {
      provide: SIMULATED_LATENCY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SimulatedLatency => {
        // Simulated providers verify any national id they are given: lending on them in
        // production would lend to anyone. The process refuses to start instead.
        if (config.env === 'production') {
          throw new Error(
            'VERIFICATION_PROVIDERS is simulated; production needs real KYC, employment and credit bureau providers.',
          );
        }
        return config.verification.simulatedLatency;
      },
    },
    { provide: KYC_PROVIDER, useClass: SimulatedKycProvider },
    { provide: EMPLOYMENT_HISTORY_PROVIDER, useClass: SimulatedEmploymentHistoryProvider },
    { provide: CREDIT_BUREAU, useClass: SimulatedCreditBureau },
    VerificationJobs,
    StartVerificationOnSubmit,
    ScoreWhenVerified,
  ],
  exports: [FINANCING_APPLICATION_REPOSITORY],
})
export class OriginationModule {}
