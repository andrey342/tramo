import { Inject, Injectable } from '@nestjs/common';

import { type NationalId } from '@shared/domain';

import { type CreditBureau } from '../../application/ports/origination-ports';
import { type BureauResult } from '../../domain';

import {
  hashOf,
  PROVIDER,
  SIMULATED_LATENCY,
  type SimulatedLatency,
  simulateLatency,
} from './simulated-providers';

// A national id ending in 7 is in a default registry, with a score of 100 to 299; any other
// scores 500 to 949.
@Injectable()
export class SimulatedCreditBureau implements CreditBureau {
  constructor(@Inject(SIMULATED_LATENCY) private readonly latency: SimulatedLatency) {}

  async check(nationalId: NationalId): Promise<BureauResult> {
    await simulateLatency(this.latency, nationalId, 'bureau');
    const hash = hashOf(nationalId, 'bureau');
    const listedInDefaultRegistry = nationalId.lastDigit === 7;
    return {
      listedInDefaultRegistry,
      score: listedInDefaultRegistry ? 100 + (hash % 200) : 500 + (hash % 450),
      provider: PROVIDER,
    };
  }
}
