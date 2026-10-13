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
  ConcurrentChargeError,
  type ChargeRepository,
  type IncomeDeclaration,
  IncomeAlreadyDeclaredError,
  type IncomeDeclarationRepository,
  OPEN_CHARGE_STATUSES,
  type PaymentMandate,
  type PaymentMandateRepository,
} from '../../src/modules/billing/domain';
import { PeriodAlreadyAssessedError } from '../../src/modules/lending/domain';
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

  findDueIds(
    asOf: CalendarDate,
    limit: number,
    afterId: string | null,
    contractId: string | null = null,
  ): Promise<string[]> {
    return Promise.resolve(
      this.ids(
        (charge) =>
          charge.status === 'scheduled' &&
          !charge.dueDate.isAfter(asOf) &&
          (!contractId || charge.contractId === contractId),
        afterId,
      ).slice(0, limit),
    );
  }

  findUnsettledIds(
    limit: number,
    afterId: string | null,
    contractId: string | null = null,
  ): Promise<string[]> {
    return Promise.resolve(
      this.ids(
        (charge) =>
          !SETTLED.includes(charge.status) && (!contractId || charge.contractId === contractId),
        afterId,
      ).slice(0, limit),
    );
  }

  hasPayoff(contractId: string): Promise<boolean> {
    return Promise.resolve(
      this.all().some(
        (charge) =>
          charge.contractId === contractId &&
          charge.kind === 'payoff' &&
          ['scheduled', 'pending', 'paid'].includes(charge.status),
      ),
    );
  }

  // One test, one worker: nothing runs at the same time. Which contracts were locked is kept, so
  // tests can check that a path that reads payoffs or mandates takes the lock.
  readonly locked: string[] = [];

  lockContract(contractId: string): Promise<void> {
    this.locked.push(contractId);
    return Promise.resolve();
  }

  findOpen(contractId: string): Promise<Charge[]> {
    return Promise.resolve(
      this.all()
        .filter(
          (charge) =>
            charge.contractId === contractId && OPEN_CHARGE_STATUSES.includes(charge.status),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
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
      throw new ConcurrentChargeError(charge.reference);
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

  override async save(mandate: PaymentMandate): Promise<void> {
    const active = await this.findActiveByContract(mandate.contractId);
    if (mandate.status === 'active' && active && active.id !== mandate.id) {
      throw new ConcurrentModificationError('PaymentMandate', mandate.id);
    }
    await super.save(mandate);
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

  override async save(declaration: IncomeDeclaration): Promise<void> {
    const twin = await this.findByPeriod(declaration.contractId, declaration.period);
    if (twin && twin.id !== declaration.id) {
      throw new IncomeAlreadyDeclaredError(declaration.period);
    }
    await super.save(declaration);
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
// Lending's ISA rules, simplified: 10 % of an income from 1,500, one month after the other; a
// plan can be set to end with a given month (its cap or last payment).
export class FakeRepaymentPlans implements RepaymentPlans {
  readonly contracts = new Map<string, Omit<RepaidContract, 'nextIsaPeriod'>>();
  readonly plans: BillablePlan[] = [];
  readonly assessed: { contractId: string; period: string; incomeCents: number | null }[] = [];
  // Loans: the principal of each instalment not paid yet.
  readonly principal = new Map<string, { number: number; principalCents: number }[]>();
  private readonly lastPeriods = new Map<string, string>();

  addContract(
    contract: Omit<RepaidContract, 'nextIsaPeriod'>,
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

  endsWith(contractId: string, period: string): this {
    this.lastPeriods.set(contractId, period);
    return this;
  }

  findContract(contractId: string): Promise<RepaidContract | null> {
    const contract = this.contracts.get(contractId);
    const plan = this.plans.find((candidate) => candidate.contractId === contractId);
    return Promise.resolve(
      contract ? { ...contract, nextIsaPeriod: plan?.nextIsaPeriod ?? null } : null,
    );
  }

  billablePlans(
    afterContractId: string | null,
    limit: number,
    contractId: string | null = null,
  ): Promise<readonly BillablePlan[]> {
    return Promise.resolve(
      [...this.plans]
        .sort((a, b) => a.contractId.localeCompare(b.contractId))
        .filter((plan) => !afterContractId || plan.contractId > afterContractId)
        .filter((plan) => !contractId || plan.contractId === contractId)
        .filter((plan) => plan.kind !== 'isa' || plan.nextIsaPeriod !== null)
        .slice(0, limit),
    );
  }

  unpaidPrincipal(
    contractId: string,
  ): Promise<readonly { number: number; principalCents: number }[] | null> {
    const contract = this.contracts.get(contractId);
    return Promise.resolve(
      contract?.product === 'installments' ? (this.principal.get(contractId) ?? []) : null,
    );
  }

  assessIsaPeriod(
    contractId: string,
    period: string,
    declaredIncomeCents: number | null,
  ): Promise<IsaAssessment> {
    const index = this.plans.findIndex((plan) => plan.contractId === contractId);
    const plan = this.plans[index];
    if (!plan?.nextIsaPeriod || period < plan.nextIsaPeriod) {
      return Promise.reject(new PeriodAlreadyAssessedError(period));
    }
    this.assessed.push({ contractId, period, incomeCents: declaredIncomeCents });
    const planEnded = this.lastPeriods.get(contractId) === period;
    const [year, month] = period.split('-').map(Number) as [number, number];
    const next =
      month === 12
        ? `${String(year + 1)}-01`
        : `${String(year)}-${String(month + 1).padStart(2, '0')}`;
    this.plans[index] = { ...plan, nextIsaPeriod: planEnded ? null : next };
    if (declaredIncomeCents === null || declaredIncomeCents < 1_500_00) {
      return Promise.resolve({ outcome: 'paused', planEnded });
    }
    return Promise.resolve({
      outcome: 'charge',
      amountCents: Math.round(declaredIncomeCents / 10),
      planEnded,
    });
  }
}
