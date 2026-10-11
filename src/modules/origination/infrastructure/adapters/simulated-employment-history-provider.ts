import { Inject, Injectable } from '@nestjs/common';

import { Money, type NationalId } from '@shared/domain';

import { type EmploymentHistoryProvider } from '../../application/ports/origination-ports';
import { type EmploymentResult } from '../../domain';

import {
  hashOf,
  PROVIDER,
  SIMULATED_LATENCY,
  type SimulatedLatency,
  simulateLatency,
} from './simulated-providers';

// "Vida laboral" derived from a hash of the id: 0 to 24 months worked, employed now three times
// out of four when they worked at least six months, earning 1,200 to 2,699 EUR a month.
@Injectable()
export class SimulatedEmploymentHistoryProvider implements EmploymentHistoryProvider {
  constructor(@Inject(SIMULATED_LATENCY) private readonly latency: SimulatedLatency) {}

  async fetch(nationalId: NationalId): Promise<EmploymentResult> {
    await simulateLatency(this.latency, nationalId, 'employment');
    const hash = hashOf(nationalId, 'employment');
    const monthsWorkedLast24 = hash % 25;
    const currentlyEmployed = monthsWorkedLast24 >= 6 && (hash >>> 8) % 4 !== 0;
    return {
      monthsWorkedLast24,
      currentlyEmployed,
      currentMonthlyIncome: currentlyEmployed
        ? Money.fromCents(1_200_00 + ((hash >>> 16) % 1_500) * 100)
        : null,
      provider: PROVIDER,
    };
  }
}
