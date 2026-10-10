import { type VatNumber } from '@shared/domain';

import { type TrainingCenter } from '../model/training-center';

export const TRAINING_CENTER_REPOSITORY = Symbol('TRAINING_CENTER_REPOSITORY');

// Repositories persist the aggregate and hand its pending events to the outbox in the caller's
// unit of work.
export interface TrainingCenterRepository {
  findById(id: string): Promise<TrainingCenter | null>;
  findByVatNumber(vatNumber: VatNumber): Promise<TrainingCenter | null>;
  save(center: TrainingCenter): Promise<void>;
}
