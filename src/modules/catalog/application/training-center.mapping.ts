import { type TrainingCenter } from '../domain';

import { type TrainingCenterDto } from './dto/training-center.dto';

export function toTrainingCenterDto(center: TrainingCenter): TrainingCenterDto {
  return {
    id: center.id,
    name: center.name,
    country: center.vatNumber.country,
    taxId: center.vatNumber.toString(),
    status: center.status,
    vatValidation: center.vatValidation,
    payoutIbanMasked: center.payoutIban.masked(),
    platformFeeBasisPoints: center.platformFee.basisPoints,
    createdAt: center.createdAt,
  };
}
