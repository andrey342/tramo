import { programCatalogContract } from '../../../../../test/contracts/program-catalog.contract';
import {
  InMemoryProgramCatalog,
  InMemoryProgramRepository,
  InMemoryTrainingCenterRepository,
} from '../../../../../test/fakes/catalog';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../../test/fakes/shared';

programCatalogContract('InMemoryProgramCatalog', () => {
  const events = new RecordingEventBus();
  const centers = new InMemoryTrainingCenterRepository(events);
  const programs = new InMemoryProgramRepository(events);
  const uow = new InlineUnitOfWork();
  return {
    catalog: new InMemoryProgramCatalog(programs, centers),
    centers,
    programs,
    run: (work) => uow.run(work),
  };
});
