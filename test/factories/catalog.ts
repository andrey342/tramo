import { uuidv7 } from 'uuidv7';

import { TrainingCenter } from '../../src/modules/catalog/domain';
import { Iban, Percentage, unwrap, VatNumber } from '../../src/shared/domain';

export const NOW = new Date('2026-10-09T10:00:00Z');
export const VALID_IBAN = 'ES9121000418450200051332';
export const OTHER_IBAN = 'DE89370400440532013000';

// Tax ids are unique per center, so each call gets its own unless one is given.
export const aTaxId = (): string => `B${uuidv7().replace(/\D/g, '').slice(-8)}`;

export function aTrainingCenter(
  overrides: { id?: string; name?: string; taxId?: string; feePercent?: number } = {},
): TrainingCenter {
  return TrainingCenter.register({
    id: overrides.id ?? uuidv7(),
    name: overrides.name ?? 'Codeworks Barcelona',
    vatNumber: unwrap(VatNumber.create('ES', overrides.taxId ?? aTaxId())),
    payoutIban: unwrap(Iban.create(VALID_IBAN)),
    platformFee: Percentage.fromPercent(overrides.feePercent ?? 5),
    now: NOW,
  });
}

export function anActiveTrainingCenter(
  overrides: Parameters<typeof aTrainingCenter>[0] = {},
): TrainingCenter {
  const center = aTrainingCenter(overrides);
  center.recordVatCheck({ outcome: 'valid', provider: 'fake', registeredName: center.name }, NOW);
  center.pullEvents();
  return center;
}
