import { catalogRepositoriesContract } from '../../../../../test/contracts/catalog-repositories.contract';
import {
  InMemoryProgramRepository,
  InMemoryTrainingCenterRepository,
} from '../../../../../test/fakes/catalog';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../../test/fakes/shared';

catalogRepositoriesContract('in-memory repositories', () => {
  const uow = new InlineUnitOfWork();
  return {
    centers: new InMemoryTrainingCenterRepository(new RecordingEventBus()),
    programs: new InMemoryProgramRepository(new RecordingEventBus()),
    run: (work) => uow.run(work),
  };
});
