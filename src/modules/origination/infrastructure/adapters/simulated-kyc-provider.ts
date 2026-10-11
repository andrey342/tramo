import { Inject, Injectable } from '@nestjs/common';

import { Percentage } from '@shared/domain';

import { type Applicant, type KycProvider } from '../../application/ports/origination-ports';
import { type KycResult } from '../../domain';

import {
  hashOf,
  PROVIDER,
  SIMULATED_LATENCY,
  type SimulatedLatency,
  simulateLatency,
} from './simulated-providers';

// Identity check: a national id ending in 9 does not match its document; any other is verified
// with a confidence of 90 to 99 %.
@Injectable()
export class SimulatedKycProvider implements KycProvider {
  constructor(@Inject(SIMULATED_LATENCY) private readonly latency: SimulatedLatency) {}

  async verifyIdentity(applicant: Applicant): Promise<KycResult> {
    await simulateLatency(this.latency, applicant.nationalId, 'kyc');
    if (applicant.nationalId.lastDigit === 9) {
      return {
        verified: false,
        confidence: Percentage.fromPercent(35),
        reasons: ['document_mismatch'],
        provider: PROVIDER,
      };
    }
    return {
      verified: true,
      confidence: Percentage.fromPercent(90 + (hashOf(applicant.nationalId, 'kyc') % 10)),
      reasons: [],
      provider: PROVIDER,
    };
  }
}
