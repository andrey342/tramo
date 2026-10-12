import { anActiveTrainingCenter, aProgram, NOW } from '../../../../../test/factories/catalog';
import { InMemoryProgramRepository } from '../../../../../test/fakes/catalog';
import { RecordingEventBus } from '../../../../../test/fakes/shared';
import { FindProgramQuery } from '../dto/program-lookup';

import { FindProgramHandler } from './find-program.query';

describe('FindProgram', () => {
  it('should find a program whatever its state, and answer null for an unknown one', async () => {
    const programs = new InMemoryProgramRepository(new RecordingEventBus());
    const archived = aProgram({ centerId: anActiveTrainingCenter().id });
    archived.archive(NOW);
    await programs.save(archived);
    const handler = new FindProgramHandler(programs);

    expect(await handler.execute(new FindProgramQuery(archived.id))).toEqual({
      id: archived.id,
      centerId: archived.centerId,
      name: archived.details.name,
      durationWeeks: archived.details.durationWeeks,
      status: 'archived',
    });
    expect(await handler.execute(new FindProgramQuery('missing'))).toBeNull();
  });
});
