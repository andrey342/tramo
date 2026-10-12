import { Decimal } from 'decimal.js';

import { type Money } from './money';

// The most an income share agreement ever collects: the principal times the cap multiplier, in
// whole hundredths (150 is 1.5 times), half-up to the cent. Shared by origination's offer and
// lending's contract, so the cap offered is the cap signed.
export function incomeShareCap(principal: Money, capMultiplierHundredths: number): Money {
  return principal.multiply(new Decimal(capMultiplierHundredths).dividedBy(100));
}
