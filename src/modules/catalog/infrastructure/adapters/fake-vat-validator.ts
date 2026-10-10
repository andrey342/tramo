import { Injectable } from '@nestjs/common';

import { type VatNumber } from '@shared/domain';

import { type VatValidator } from '../../application/ports/catalog-ports';
import { type VatCheckResult } from '../../domain';

const PROVIDER = 'fake';

// Deterministic stand-in for VIES, selected with VIES_MODE=fake (e2e tests, offline demo). It
// follows the test service's table (200 invalid, 300 unavailable) and accepts every other number,
// so realistic tax ids in seed data activate their centers.
@Injectable()
export class FakeVatValidator implements VatValidator {
  check(vatNumber: VatNumber): Promise<VatCheckResult> {
    switch (vatNumber.number) {
      case '200':
        return Promise.resolve({ outcome: 'invalid', provider: PROVIDER });
      case '300':
        return Promise.resolve({
          outcome: 'unavailable',
          provider: PROVIDER,
          reason: 'SERVICE_UNAVAILABLE',
        });
      default:
        return Promise.resolve({ outcome: 'valid', provider: PROVIDER, registeredName: null });
    }
  }
}
