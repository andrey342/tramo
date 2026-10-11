import { createHash } from 'node:crypto';

import { type NationalId } from '@shared/domain';

// Shared by the simulated KYC, employment and bureau providers. Tramo has no contracts with real
// providers yet; these stand in for them in every environment, answering deterministically from
// the national id so that demos and tests can pick the scenario they need:
// - a number ending in 9 fails identity verification;
// - a number ending in 7 is in a default registry;
// - everything else is derived from a hash of the id, the same answer every time.
export const PROVIDER = 'simulated';

export interface SimulatedLatency {
  readonly minMs: number;
  readonly maxMs: number;
}

export const NO_LATENCY: SimulatedLatency = { minMs: 0, maxMs: 0 };

// A stable number per id and per provider, so the three providers do not move together.
export function hashOf(nationalId: NationalId, salt: string): number {
  return createHash('sha256').update(`${salt}:${nationalId.value}`).digest().readUInt32BE(0);
}

// Waits as long as a real provider would (`minMs` to `maxMs`), deterministically per id.
export async function simulateLatency(
  latency: SimulatedLatency,
  nationalId: NationalId,
  salt: string,
): Promise<void> {
  const spread = latency.maxMs - latency.minMs;
  const ms =
    latency.minMs + (spread > 0 ? hashOf(nationalId, `${salt}:latency`) % (spread + 1) : 0);
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const SIMULATED_LATENCY = Symbol('SIMULATED_LATENCY');
