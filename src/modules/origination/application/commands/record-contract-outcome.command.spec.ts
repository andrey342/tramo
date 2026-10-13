import { uuidv7 } from 'uuidv7';

import { EntityNotFoundError, FixedClock } from '@shared/domain';

import { anAcceptedApplication, LATER } from '../../../../../test/factories/origination';
import { InMemoryFinancingApplicationRepository } from '../../../../../test/fakes/origination';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../../test/fakes/shared';
import { OriginationEvents } from '../../domain';

import {
  RecordContractOutcomeCommand,
  RecordContractOutcomeHandler,
} from './record-contract-outcome.command';

async function setup() {
  const events = new RecordingEventBus();
  const applications = new InMemoryFinancingApplicationRepository(events);
  const accepted = anAcceptedApplication();
  await applications.save(accepted);
  const handler = new RecordContractOutcomeHandler(
    new InlineUnitOfWork(),
    applications,
    new FixedClock(LATER),
  );
  return { events, applications, accepted, handler };
}

describe('RecordContractOutcomeHandler', () => {
  it('should withdraw the application once when its contract is cancelled twice', async () => {
    const { events, applications, accepted, handler } = await setup();

    await handler.execute(new RecordContractOutcomeCommand(accepted.id, 'cancelled'));
    await handler.execute(new RecordContractOutcomeCommand(accepted.id, 'cancelled'));

    const withdrawn = await applications.findById(accepted.id);
    expect(withdrawn?.status).toBe('withdrawn');
    expect(withdrawn?.statusChangedAt).toEqual(LATER);
    expect(withdrawn?.version).toBe(2);
    expect(events.ofType(OriginationEvents.ApplicationWithdrawn)).toHaveLength(1);
  });

  it('should close the application when its contract is completed', async () => {
    const { events, applications, accepted, handler } = await setup();

    await handler.execute(new RecordContractOutcomeCommand(accepted.id, 'completed'));

    expect((await applications.findById(accepted.id))?.status).toBe('closed');
    expect(events.ofType(OriginationEvents.ApplicationClosed)).toHaveLength(1);
  });

  it('should fail when the application is not known', async () => {
    const { handler } = await setup();

    await expect(
      handler.execute(new RecordContractOutcomeCommand(uuidv7(), 'cancelled')),
    ).rejects.toThrow(EntityNotFoundError);
  });
});
