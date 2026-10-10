import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { type Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { type Principal } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';

import { aTaxId, VALID_IBAN } from '../../../../../test/factories/catalog';
import { eventually } from '../../../../../test/helpers/eventually';
import { RegisterTrainingCenterCommand } from '../../application/commands/register-training-center.command';
import { CatalogModule } from '../../catalog.module';
import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '../../domain';

const ADMIN: Principal = { kind: 'user', userId: 'admin-1', roles: ['admin'], centerId: null };

describe('VAT check after registration (integration)', () => {
  let app: INestApplicationContext;
  let commands: CommandBus;
  let publisher: OutboxPublisher;
  let centers: TrainingCenterRepository;
  let db: DataSource;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        CatalogModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    commands = app.get(CommandBus);
    publisher = app.get(OutboxPublisher);
    centers = app.get(TRAINING_CENTER_REPOSITORY);
    db = app.get(DataSource);
    // Other suites leave unpublished rows behind; only this suite's events matter here.
    await db.query(
      'UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const register = async (taxId: string): Promise<string> => {
    const { centerId } = await commands.execute(
      new RegisterTrainingCenterCommand(ADMIN, 'Codeworks', 'ES', taxId, VALID_IBAN, 500),
    );
    await publisher.publishBatch();
    return centerId;
  };

  it('should activate a new center once the registry confirms its number', async () => {
    const centerId = await register(aTaxId());

    await eventually(async () => {
      expect((await centers.findById(centerId))?.status).toBe('active');
    });
  });

  it('should fail the job, to be retried, while the registry cannot answer', async () => {
    const centerId = await register('300');
    const [event] = await db.query<{ id: string }[]>(
      `SELECT id FROM shared.outbox_messages WHERE aggregate_id = $1`,
      [centerId],
    );
    const queue = app.get<Queue>(getQueueToken('events.catalog'));

    await eventually(async () => {
      const job = await queue.getJob(`${event?.id ?? ''}.catalog.verify-center-vat`);
      expect(job?.attemptsMade).toBeGreaterThanOrEqual(1);
      expect(job?.failedReason).toContain('VIES could not check');
    });
    const center = await centers.findById(centerId);
    expect(center?.status).toBe('pending_verification');
    expect(center?.vatValidation).toBeNull();
  });
});
