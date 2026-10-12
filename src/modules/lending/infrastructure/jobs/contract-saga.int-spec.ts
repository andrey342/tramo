import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { type Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { uuidv7 } from 'uuidv7';

import { CatalogModule } from '@modules/catalog/catalog.module';
import {
  PROGRAM_REPOSITORY,
  type ProgramRepository,
  type TrainingCenter,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '@modules/catalog/domain';
import {
  type OfferAcceptedPayload,
  OriginationEvents,
} from '@modules/origination/domain/events/origination-events';
import { EVENT_BUS, type EventBus, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { Iban, unwrap } from '@shared/domain';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';
import { QueueNames } from '@shared/infrastructure/queues';

import { anActiveTrainingCenter, aProgram, NOW } from '../../../../../test/factories/catalog';
import { CLOSED_IBAN, OPEN_IBAN } from '../../../../../test/fakes/lending';
import { eventually } from '../../../../../test/helpers/eventually';
import { RecordSignatureEventCommand } from '../../application/commands/record-signature-event.command';
import { RetryDisbursementCommand } from '../../application/commands/retry-disbursement.command';
import {
  type Contract,
  CONTRACT_REPOSITORY,
  type ContractRepository,
  DISBURSEMENT_REPOSITORY,
  type DisbursementRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';
import { LendingWorkerModule } from '../../lending-worker.module';

describe('contract saga (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let contracts: ContractRepository;
  let disbursements: DisbursementRepository;
  let plans: FinancingPlanRepository;
  let centers: TrainingCenterRepository;
  let publisher: OutboxPublisher;
  let commands: CommandBus;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        CatalogModule,
        LendingWorkerModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    contracts = app.get(CONTRACT_REPOSITORY);
    disbursements = app.get(DISBURSEMENT_REPOSITORY);
    plans = app.get(FINANCING_PLAN_REPOSITORY);
    centers = app.get(TRAINING_CENTER_REPOSITORY);
    publisher = app.get(OutboxPublisher);
    commands = app.get(CommandBus);
    // Other suites leave unpublished rows behind; only this suite's events matter here.
    await app
      .get(DataSource)
      .query('UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL');
  });

  afterAll(async () => {
    await app.close();
  });

  // A center paid into `iban`, a 12 week program of it, and the OfferAccepted origination would
  // leave in the outbox for 6,000 in 12 monthly instalments at 9 %.
  async function acceptOffer(
    iban: string,
  ): Promise<{ applicationId: string; center: TrainingCenter }> {
    const center = anActiveTrainingCenter({ feePercent: 5 });
    center.changePayoutIban(unwrap(Iban.create(iban)), NOW);
    center.pullEvents();
    const program = aProgram({ centerId: center.id, details: { durationWeeks: 12 } });
    const applicationId = uuidv7();
    const payload: OfferAcceptedPayload = {
      applicationId,
      applicantId: uuidv7(),
      centerId: center.id,
      programId: program.id,
      programName: 'Full Stack Bootcamp',
      amountCents: 6_000_00,
      product: { kind: 'installments', termMonths: 12, annualRateBasisPoints: 900 },
    };
    await uow.run(async () => {
      await centers.save(center);
      await app.get<ProgramRepository>(PROGRAM_REPOSITORY).save(program);
      await app.get<EventBus>(EVENT_BUS).publish([
        {
          eventType: OriginationEvents.OfferAccepted,
          aggregateType: 'FinancingApplication',
          aggregateId: applicationId,
          occurredAt: new Date(),
          payload,
        },
      ]);
    });
    return { applicationId, center };
  }

  // The outbox is published by hand: each step of the saga writes the next events.
  async function until<T>(read: () => Promise<T>, check: (value: T) => void): Promise<T> {
    let last: T | undefined;
    await eventually(
      async () => {
        await publisher.publishBatch();
        last = await read();
        check(last);
      },
      { timeoutMs: 30_000 },
    );
    return last as T;
  }

  const contractOf = (applicationId: string) => () => contracts.findByApplicationId(applicationId);

  async function sign(contract: Contract): Promise<void> {
    await commands.execute(
      new RecordSignatureEventCommand({
        type: 'signed',
        envelopeId: contract.signature?.envelopeId ?? '',
        documentHash: contract.signature?.documentHash ?? '',
        occurredAt: new Date(),
      }),
    );
  }

  it('should draw up, send, disburse, activate and open the plan of an accepted offer', async () => {
    const { applicationId } = await acceptOffer(OPEN_IBAN);

    const sent = await until(contractOf(applicationId), (contract) => {
      expect(contract?.status).toBe('sent_for_signature');
    });
    expect(sent?.terms.platformFee.basisPoints).toBe(500);
    expect(sent?.program.durationWeeks).toBe(12);
    await sign(sent!);

    const active = await until(contractOf(applicationId), (contract) => {
      expect(contract?.status).toBe('active');
    });
    const plan = await until(
      () => plans.findByContractId(active!.id),
      (found) => {
        expect(found).not.toBeNull();
      },
    );
    const disbursement = await disbursements.findByContractId(active!.id);
    expect(disbursement).toMatchObject({ status: 'settled', attempt: 1 });
    expect(disbursement?.amount.cents).toBe(5_700_00);
    expect(plan?.terms.kind).toBe('installments');
    const signatures = app.get<Queue>(getQueueToken(QueueNames.SIGNATURES));
    expect(await (await signatures.getJob(`${active!.id}.send`))?.isCompleted()).toBe(true);
  }, 60_000);

  it('should fail a transfer to a closed account and pay the corrected one on retry', async () => {
    const { applicationId, center } = await acceptOffer(CLOSED_IBAN);
    const sent = await until(contractOf(applicationId), (contract) => {
      expect(contract?.status).toBe('sent_for_signature');
    });
    await sign(sent!);

    const failed = await until(
      () => disbursements.findByContractId(sent!.id),
      (found) => {
        expect(found?.status).toBe('failed');
      },
    );
    expect(failed?.failureReason).toBe('account_closed');

    center.changePayoutIban(unwrap(Iban.create(OPEN_IBAN)), new Date());
    await uow.run(() => centers.save(center));
    await commands.execute(
      new RetryDisbursementCommand(
        { kind: 'user', userId: uuidv7(), roles: ['ops'], centerId: null },
        failed!.id,
      ),
    );

    await until(contractOf(applicationId), (contract) => {
      expect(contract?.status).toBe('active');
    });
    expect(await disbursements.findByContractId(sent!.id)).toMatchObject({
      status: 'settled',
      attempt: 2,
    });
  }, 60_000);
});
