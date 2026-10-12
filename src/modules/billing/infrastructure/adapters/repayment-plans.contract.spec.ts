import { uuidv7 } from 'uuidv7';

import { repaymentPlansContract } from '../../../../../test/contracts/repayment-plans.contract';
import { FakeRepaymentPlans } from '../../../../../test/fakes/billing';

repaymentPlansContract('FakeRepaymentPlans', () => {
  const [installmentsContractId, isaContractId, studentId, centerId] = [
    uuidv7(),
    uuidv7(),
    uuidv7(),
    uuidv7(),
  ];
  const plans = new FakeRepaymentPlans()
    .addContract(
      {
        id: installmentsContractId,
        studentId,
        centerId,
        product: 'installments',
        status: 'active',
      },
      {
        kind: 'installments',
        unpaidInstallments: Array.from({ length: 23 }, (_, index) => ({
          number: index + 2,
          dueDate: `2027-${String((index % 12) + 1).padStart(2, '0')}-12`,
          totalCents: 337_50,
        })),
        nextIsaPeriod: null,
      },
    )
    .addContract(
      { id: isaContractId, studentId, centerId, product: 'isa', status: 'active' },
      { kind: 'isa', unpaidInstallments: [], nextIsaPeriod: '2026-07' },
    );
  return { plans, installmentsContractId, studentId, isaContractId };
});
