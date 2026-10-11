import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { NationalId, unwrap } from '@shared/domain';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';
import { QueueNames } from '@shared/infrastructure/queues';

import {
  aCompleteProfile,
  aProgramSnapshot,
  INSTALLMENTS_24,
} from '../../../../../test/factories/origination';
import { eventually } from '../../../../../test/helpers/eventually';
import {
  FINANCING_APPLICATION_REPOSITORY,
  FinancingApplication,
  type FinancingApplicationRepository,
} from '../../domain';
import { OriginationWorkerModule } from '../../origination-worker.module';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('verification saga (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let applications: FinancingApplicationRepository;
  let publisher: OutboxPublisher;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        OriginationWorkerModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    applications = app.get(FINANCING_APPLICATION_REPOSITORY);
    publisher = app.get(OutboxPublisher);
    // Other suites leave unpublished rows behind; only this suite's events matter here.
    await app
      .get(DataSource)
      .query('UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL');
  });

  afterAll(async () => {
    await app.close();
  });

  // Saved as submitted, with its ApplicationSubmitted event in the outbox: what the api leaves.
  async function submit(nationalId: string, at = new Date()): Promise<string> {
    const application = FinancingApplication.start({
      id: uuidv7(),
      applicantId: uuidv7(),
      origin: 'student',
      program: aProgramSnapshot(),
      product: INSTALLMENTS_24,
      profile: aCompleteProfile({ nationalId: unwrap(NationalId.create(nationalId)) }),
      now: at,
    });
    application.submit(application.program, at);
    await uow.run(() => applications.save(application));
    return application.id;
  }

  // The outbox is published by hand: each step of the saga writes the next events.
  const settle = async (id: string, status: string): Promise<void> => {
    await eventually(
      async () => {
        await publisher.publishBatch();
        expect((await applications.findById(id))?.status).toBe(status);
      },
      { timeoutMs: 20_000 },
    );
  };

  it('should verify, score and approve a good applicant, one job per provider', async () => {
    // 56781234F: employed, 19 months worked, 1,725 EUR a month on record, bureau 592.
    const id = await submit('56781234F');

    await settle(id, 'approved');

    const application = await applications.findById(id);
    expect(application?.decision?.hardRulesBroken).toEqual([]);
    const queue = app.get<Queue>(getQueueToken(QueueNames.VERIFICATIONS));
    for (const type of ['kyc', 'employment', 'bureau']) {
      expect(await (await queue.getJob(`${id}.${type}`))?.isCompleted()).toBe(true);
    }
  });

  it('should reject an applicant whose identity does not check out', async () => {
    // 12345679 mod 23 = 15, letter S; ending in 9, KYC fails.
    const id = await submit('12345679S');

    await settle(id, 'rejected');

    expect((await applications.findById(id))?.decision?.hardRulesBroken).toEqual([
      'identity_not_verified',
    ]);
  });

  it('should expire an application that has not moved for two weeks', async () => {
    const old = FinancingApplication.start({
      id: uuidv7(),
      applicantId: uuidv7(),
      origin: 'student',
      program: aProgramSnapshot(),
      product: INSTALLMENTS_24,
      profile: aCompleteProfile(),
      now: new Date(Date.now() - 15 * DAY_MS),
    });
    await uow.run(() => applications.save(old));

    // An application that cannot be loaded (its national id copied from another row) comes
    // first in the sweep; it must not stop the others from expiring.
    const unreadable = FinancingApplication.start({
      id: uuidv7(),
      applicantId: uuidv7(),
      origin: 'student',
      program: aProgramSnapshot(),
      product: INSTALLMENTS_24,
      profile: aCompleteProfile(),
      now: new Date(Date.now() - 16 * DAY_MS),
    });
    await uow.run(() => applications.save(unreadable));
    await app.get(DataSource).query(
      `UPDATE origination.financing_applications SET national_id_encrypted =
           (SELECT national_id_encrypted FROM origination.financing_applications WHERE id = $1)
         WHERE id = $2`,
      [old.id, unreadable.id],
    );

    await app.get<Queue>(getQueueToken(QueueNames.APPLICATION_EXPIRY)).add('sweep', {});

    await eventually(async () => {
      expect((await applications.findById(old.id))?.status).toBe('expired');
    });
  });
});
