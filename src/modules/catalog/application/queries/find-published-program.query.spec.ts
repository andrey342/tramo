import { anActiveTrainingCenter, aProgram, NOW } from '../../../../../test/factories/catalog';
import {
  InMemoryProgramCatalog,
  InMemoryProgramRepository,
  InMemoryTrainingCenterRepository,
} from '../../../../../test/fakes/catalog';
import { RecordingEventBus } from '../../../../../test/fakes/shared';
import { FindPublishedProgramQuery } from '../dto/program-lookup';

import { FindPublishedProgramHandler } from './find-published-program.query';

describe('FindPublishedProgram', () => {
  it('should find a published program and not a draft', async () => {
    const events = new RecordingEventBus();
    const centers = new InMemoryTrainingCenterRepository(events);
    const programs = new InMemoryProgramRepository(events);
    const center = anActiveTrainingCenter();
    const published = aProgram({ centerId: center.id });
    published.publish(center, NOW);
    const draft = aProgram({ centerId: center.id });
    await centers.save(center);
    await programs.save(published);
    await programs.save(draft);
    const handler = new FindPublishedProgramHandler(new InMemoryProgramCatalog(programs, centers));

    expect((await handler.execute(new FindPublishedProgramQuery(published.id)))?.centerName).toBe(
      center.name,
    );
    expect(await handler.execute(new FindPublishedProgramQuery(draft.id))).toBeNull();
  });
});
