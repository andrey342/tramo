import { type VatNumber } from '@shared/domain';

import { type Program } from '../model/program';
import { type TrainingCenter } from '../model/training-center';

export const TRAINING_CENTER_REPOSITORY = Symbol('TRAINING_CENTER_REPOSITORY');

// Repositories persist the aggregate and hand its pending events to the outbox in the caller's
// unit of work.
export interface TrainingCenterRepository {
  findById(id: string): Promise<TrainingCenter | null>;
  findByVatNumber(vatNumber: VatNumber): Promise<TrainingCenter | null>;
  save(center: TrainingCenter): Promise<void>;
}

export const PROGRAM_REPOSITORY = Symbol('PROGRAM_REPOSITORY');

export interface ProgramRepository {
  findById(id: string): Promise<Program | null>;
  save(program: Program): Promise<void>;
}
