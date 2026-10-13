import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  EVENT_BUS,
  EVENT_HISTORY,
  type EventBus,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { eventHistoryContract } from '../../../../test/contracts/event-history.contract';

describe('OutboxEventHistory (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' })],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  eventHistoryContract('OutboxEventHistory', () => {
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    return {
      history: app.get(EVENT_HISTORY),
      record: (events) =>
        uow.run(() =>
          app.get<EventBus>(EVENT_BUS).publish(
            events.map((event) => ({
              eventType: event.eventType,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              occurredAt: new Date(event.occurredAt),
              payload: event.payload,
            })),
          ),
        ),
      run: (work) => uow.run(work),
    };
  });
});
