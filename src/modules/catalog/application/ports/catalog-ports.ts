import { type VatNumber } from '@shared/domain';

import { type VatCheckResult } from '../../domain';

export const VAT_VALIDATOR = Symbol('VAT_VALIDATOR');

// Asks the EU VAT registry (VIES) whether a number is registered and active. Never throws for an
// unreachable registry: it answers `unavailable`, and the center stays unverified until a retry.
export interface VatValidator {
  check(vatNumber: VatNumber): Promise<VatCheckResult>;
}
