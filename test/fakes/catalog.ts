import {
  CenterAlreadyRegisteredError,
  type Program,
  type ProgramRepository,
  type TrainingCenter,
  type TrainingCenterRepository,
} from '../../src/modules/catalog/domain';
import { type VatNumber } from '../../src/shared/domain';

import { InMemoryRepository } from './shared';

export class InMemoryTrainingCenterRepository
  extends InMemoryRepository<TrainingCenter>
  implements TrainingCenterRepository
{
  findByVatNumber(vatNumber: VatNumber): Promise<TrainingCenter | null> {
    return Promise.resolve(this.all().find((center) => center.vatNumber.equals(vatNumber)) ?? null);
  }

  // Mirrors the unique index on (country, tax_number).
  override async save(center: TrainingCenter): Promise<void> {
    const other = this.all().find(
      (stored) => stored.id !== center.id && stored.vatNumber.equals(center.vatNumber),
    );
    if (other) {
      throw new CenterAlreadyRegisteredError(center.vatNumber.toString());
    }
    await super.save(center);
  }
}

export class InMemoryProgramRepository
  extends InMemoryRepository<Program>
  implements ProgramRepository {}

// Runtime fake (chosen by VIES_MODE=fake), re-exported so tests take every double from here.
export { FakeVatValidator } from '../../src/modules/catalog/infrastructure/adapters/fake-vat-validator';
