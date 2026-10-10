import { type CursorPage, type PageRequest } from '@shared/application';
import { type VatNumber } from '@shared/domain';

import { type VatCheckResult } from '../../domain';
import { type CatalogProgramDto, type ProgramFilter } from '../dto/program.dto';

export const VAT_VALIDATOR = Symbol('VAT_VALIDATOR');

// Asks the EU VAT registry (VIES) whether a number is registered and active. Never throws for an
// unreachable registry: it answers `unavailable`, and the center stays unverified until a retry.
export interface VatValidator {
  check(vatNumber: VatNumber): Promise<VatCheckResult>;
}

export const PROGRAM_CATALOG = Symbol('PROGRAM_CATALOG');

// The read side of the public catalog: published programs of active centers only, newest first,
// paginated by cursor. A query, not a repository: it never returns aggregates (ADR 002).
export interface ProgramCatalog {
  list(filter: ProgramFilter, page: PageRequest): Promise<CursorPage<CatalogProgramDto>>;
  findPublished(id: string): Promise<CatalogProgramDto | null>;
}
