import {
  type CatalogProgramDto,
  type ProgramFilter,
} from '../../src/modules/catalog/application/dto/program.dto';
import { type ProgramCatalog } from '../../src/modules/catalog/application/ports/catalog-ports';
import { toProgramDto } from '../../src/modules/catalog/application/program.mapping';
import {
  CenterAlreadyRegisteredError,
  type Program,
  type ProgramRepository,
  type TrainingCenter,
  type TrainingCenterRepository,
} from '../../src/modules/catalog/domain';
import { type CursorPage, type PageRequest } from '../../src/shared/application';
import { type VatNumber } from '../../src/shared/domain';
import {
  decodeCursor,
  encodeCursor,
} from '../../src/shared/infrastructure/database/cursor-pagination';

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

// Same answers as the SQL read model, computed over the in-memory repositories.
export class InMemoryProgramCatalog implements ProgramCatalog {
  constructor(
    private readonly programs: InMemoryProgramRepository,
    private readonly centers: InMemoryTrainingCenterRepository,
  ) {}

  list(filter: ProgramFilter, page: PageRequest): Promise<CursorPage<CatalogProgramDto>> {
    const position = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
    const matching = this.visible()
      .filter((program) => matches(program, filter))
      .sort(newestFirst)
      .filter(
        (program) =>
          !position ||
          program.createdAt.toISOString() < position.sortValue ||
          (program.createdAt.toISOString() === position.sortValue && program.id < position.id),
      );
    const data = matching.slice(0, page.limit);
    const last = data.at(-1);
    return Promise.resolve({
      data: data.map((program) => this.toDto(program)),
      nextCursor:
        matching.length > page.limit && last
          ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id })
          : null,
    });
  }

  findPublished(id: string): Promise<CatalogProgramDto | null> {
    const program = this.visible().find((candidate) => candidate.id === id);
    return Promise.resolve(program ? this.toDto(program) : null);
  }

  private visible(): Program[] {
    const active = new Set(
      this.centers
        .all()
        .filter((center) => center.isActive)
        .map((center) => center.id),
    );
    return this.programs
      .all()
      .filter((program) => program.isPublished && active.has(program.centerId));
  }

  private toDto(program: Program): CatalogProgramDto {
    const center = this.centers.all().find((candidate) => candidate.id === program.centerId);
    if (!center) {
      throw new Error(`Program ${program.id} has no center.`);
    }
    return { ...toProgramDto(program), centerName: center.name };
  }
}

function matches(program: Program, filter: ProgramFilter): boolean {
  const { price, modality } = program.details;
  return (
    (filter.centerId === undefined || program.centerId === filter.centerId) &&
    (filter.modality === undefined || modality === filter.modality) &&
    (filter.product === undefined || program.financing.products.includes(filter.product)) &&
    (filter.minPriceCents === undefined || price.cents >= filter.minPriceCents) &&
    (filter.maxPriceCents === undefined || price.cents <= filter.maxPriceCents)
  );
}

function newestFirst(a: Program, b: Program): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
