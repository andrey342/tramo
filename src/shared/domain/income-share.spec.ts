import { incomeShareCap } from './income-share';
import { Money } from './money';

describe('incomeShareCap', () => {
  it.each([
    ['7500.00', 150, '11250.00'],
    ['7500.00', 100, '7500.00'],
    ['7500.00', 133, '9975.00'],
    // 1,234.57 × 1.5 = 1,851.855, half-up.
    ['1234.57', 150, '1851.86'],
  ])('should cap %s at %d hundredths at %s', (principal, hundredths, cap) => {
    expect(incomeShareCap(Money.fromDecimal(principal), hundredths)).toEqual(
      Money.fromDecimal(cap),
    );
  });
});
