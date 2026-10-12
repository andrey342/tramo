import { toChargeDto } from '../../src/modules/billing/application/billing.mapping';
import {
  type ChargeDto,
  type LedgerEntryDto,
} from '../../src/modules/billing/application/dto/billing.dto';
import {
  type BillablePlan,
  type BillingQueries,
  type CollectionRequest,
  type DeclarationReminders,
  type IsaAssessment,
  type PaymentGateway,
  type RepaidContract,
  type RepaymentPlans,
} from '../../src/modules/billing/application/ports/billing-ports';
import {
  type Charge,
  type ChargeRepository,
  type IncomeDeclaration,
  type IncomeDeclarationRepository,
  type PaymentMandate,
  type PaymentMandateRepository,
} from '../../src/modules/billing/domain';
import { type CursorPage, type PageRequest } from '../../src/shared/application';
import { type CalendarDate, ConcurrentModificationError } from '../../src/shared/domain';

import { InMemoryRepository } from './shared';

const SETTLED = ['paid', 'written_off', 'cancelled'];

export class InMemoryChargeRepository
  extends InMemoryRepository<Charge>
  implements ChargeRepository
{
  findByReference(contractId: string, reference: string): Promise<Charge | null> {
    return Promise.resolve(
      this.all().find(
        (charge) => charge.contractId === contractId && charge.reference === reference,
      ) ?? null,
    );
  }

  findDueIds(asOf: CalendarDate, limit: number, afterId: string | null): Promise<string[]> {
    return Promise.resolve(
      this.ids(
        (charge) => charge.status === 'scheduled' && !charge.dueDate.isAfter(asOf),
        afterId,
      ).slice(0, limit),
    );
  }

  findUnsettledIds(limit: number, afterId: string | null): Promise<string[]> {
    return Promise.resolve(
      this.ids((charge) => !SETTLED.includes(charge.status), afterId).slice(0, limit),
    );
  }

  findScheduledIds(contractId: string): Promise<string[]> {
    return Promise.resolve(
      this.ids((charge) => charge.contractId === contractId && charge.status === 'scheduled', null),
    );
  }

  hasOtherChargesInArrears(contractId: string, exceptChargeId: string): Promise<boolean> {
    return Promise.resolve(
      this.all().some(
        (charge) =>
          charge.contractId === contractId && charge.id !== exceptChargeId && charge.inArrears,
      ),
    );
  }

  override async save(charge: Charge): Promise<void> {
    const twin = await this.findByReference(charge.contractId, charge.reference);
    if (twin && twin.id !== charge.id) {
      throw new ConcurrentModificationError('Charge', charge.id);
    }
    await super.save(charge);
  }

  private ids(match: (charge: Charge) => boolean, afterId: string | null): string[] {
    return this.all()
      .filter(match)
      .map((charge) => charge.id)
      .filter((id) => !afterId || id > afterId)
      .sort();
  }
}

export class InMemoryPaymentMandateRepository
  extends InMemoryRepository<PaymentMandate>
  implements PaymentMandateRepository
{
  findActiveByContract(contractId: string): Promise<PaymentMandate | null> {
    return Promise.resolve(
      this.all().find(
        (mandate) => mandate.contractId === contractId && mandate.status === 'active',
      ) ?? null,
    );
  }
}

export class InMemoryIncomeDeclarationRepository
  extends InMemoryRepository<IncomeDeclaration>
  implements IncomeDeclarationRepository
{
  findByPeriod(contractId: string, period: string): Promise<IncomeDeclaration | null> {
    return Promise.resolve(
      this.all().find(
        (declaration) => declaration.contractId === contractId && declaration.period === period,
      ) ?? null,
    );
  }
}

// The ledger projection, as the real consumer writes it from charge events.
export class InMemoryBillingQueries implements BillingQueries {
  readonly entries: (Omit<LedgerEntryDto, 'balanceCents'> & { contractId: string })[] = [];

  constructor(private readonly charges: InMemoryChargeRepository) {}

  listCharges(contractId: string, page: PageRequest): Promise<CursorPage<ChargeDto>> {
    const data = this.charges
      .all()
      .filter((charge) => charge.contractId === contractId)
      .sort((a, b) => b.dueDate.compare(a.dueDate) || b.id.localeCompare(a.id))
      .slice(0, page.limit)
      .map(toChargeDto);
    return Promise.resolve({ data, nextCursor: null });
  }

  ledger(contractId: string): Promise<readonly Omit<LedgerEntryDto, 'balanceCents'>[]> {
    return Promise.resolve(
      this.entries
        .filter((entry) => entry.contractId === contractId)
        .map(({ contractId: _contractId, ...entry }) => entry),
    );
  }
}

export class InMemoryDeclarationReminders implements DeclarationReminders {
  readonly sent = new Set<string>();

  record(contractId: string, period: string): Promise<boolean> {
    const key = `${contractId}:${period}`;
    if (this.sent.has(key)) {
      return Promise.resolve(false);
    }
    this.sent.add(key);
    return Promise.resolve(true);
  }
}

// Remembers requests by key; the outcome comes later through RecordPaymentResult in the tests.
export class FakePaymentGateway implements PaymentGateway {
  readonly requests = new Map<string, CollectionRequest & { paymentId: string }>();
  failWith: Error | null = null;

  collect(request: CollectionRequest): Promise<{ readonly paymentId: string }> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    const existing = this.requests.get(request.idempotencyKey);
    if (existing) {
      return Promise.resolve({ paymentId: existing.paymentId });
    }
    const paymentId = `fake-pay-${String(this.requests.size + 1)}`;
    this.requests.set(request.idempotencyKey, { ...request, paymentId });
    return Promise.resolve({ paymentId });
  }
}

// Contracts and plans as lending would answer; an ISA assessment is a function of the income
// declared (10 % of it, nothing below 1,500), and records the months asked about.
export class FakeRepaymentPlans implements RepaymentPlans {
  readonly contracts = new Map<string, RepaidContract>();
  readonly plans: BillablePlan[] = [];
  readonly assessed: { contractId: string; period: string; incomeCents: number | null }[] = [];

  addContract(
    contract: RepaidContract,
    plan?: Omit<BillablePlan, 'contractId' | 'studentId' | 'centerId'>,
  ): this {
    this.contracts.set(contract.id, contract);
    if (plan) {
      this.plans.push({
        contractId: contract.id,
        studentId: contract.studentId,
        centerId: contract.centerId,
        ...plan,
      });
    }
    return this;
  }

  findContract(contractId: string): Promise<RepaidContract | null> {
    return Promise.resolve(this.contracts.get(contractId) ?? null);
  }

  billablePlans(afterContractId: string | null, limit: number): Promise<readonly BillablePlan[]> {
    return Promise.resolve(
      [...this.plans]
        .sort((a, b) => a.contractId.localeCompare(b.contractId))
        .filter((plan) => !afterContractId || plan.contractId > afterContractId)
        .slice(0, limit),
    );
  }

  assessIsaPeriod(
    contractId: string,
    period: string,
    declaredIncomeCents: number | null,
  ): Promise<IsaAssessment> {
    this.assessed.push({ contractId, period, incomeCents: declaredIncomeCents });
    if (declaredIncomeCents === null || declaredIncomeCents < 1_500_00) {
      return Promise.resolve({ outcome: 'paused' });
    }
    return Promise.resolve({
      outcome: 'charge',
      amountCents: Math.round(declaredIncomeCents / 10),
    });
  }
}
