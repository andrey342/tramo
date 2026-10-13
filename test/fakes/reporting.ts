import {
  type ApplicationCountsDto,
  type CenterFiguresDto,
  type ContractCountsDto,
  type MoneyFiguresDto,
  type OpsFiguresDto,
  type ProgramFiguresDto,
} from '../../src/modules/reporting/application/dto/reporting.dto';
import {
  type ApplicationFact,
  type ChargeFact,
  type ContractFact,
  type DisbursementFact,
  type Product,
  type Programs,
  type ProgramScores,
  type QueueHealth,
  type RebuildJobs,
  type ReportingStore,
} from '../../src/modules/reporting/application/ports/reporting-ports';
import { type EventHistory, type IntegrationEvent } from '../../src/shared/application';

type Row<F> = Omit<F, 'at' | 'eventId'> & { lastEventAt: Date; lastEventId: string };

// The same rule as the SQL upserts: descriptive fields keep what an event did not say, status
// fields follow the most recent event by (time, id).
function merge<F extends { at: Date; eventId: string }>(
  existing: Row<F> | undefined,
  fact: F,
  statuses: readonly string[],
): Row<F> {
  const { at, eventId, ...fields } = fact;
  if (!existing) {
    return { ...fields, lastEventAt: at, lastEventId: eventId };
  }
  const newer =
    at.getTime() > existing.lastEventAt.getTime() ||
    (at.getTime() === existing.lastEventAt.getTime() && eventId >= existing.lastEventId);
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (statuses.includes(key)) {
      if (newer) merged[key] = value;
    } else {
      merged[key] = value;
    }
  }
  merged.lastEventAt = newer ? at : existing.lastEventAt;
  merged.lastEventId = newer ? eventId : existing.lastEventId;
  return merged as Row<F>;
}

type Tally<T> = { -readonly [K in keyof T]: T[K] };

const noContracts = (): Tally<ContractCountsDto> => ({
  active: 0,
  inArrears: 0,
  completed: 0,
  defaulted: 0,
  cancelled: 0,
});
const noMoney = (): Tally<MoneyFiguresDto> => ({
  disbursedCents: 0,
  collectedCents: 0,
  outstandingCents: 0,
  writtenOffCents: 0,
});

export class InMemoryReportingStore implements ReportingStore {
  readonly applications = new Map<string, Row<ApplicationFact>>();
  readonly contracts = new Map<string, Row<ContractFact>>();
  readonly disbursements = new Map<string, Row<DisbursementFact>>();
  readonly charges = new Map<string, Row<ChargeFact>>();

  recordApplication(fact: ApplicationFact): Promise<void> {
    this.applications.set(
      fact.applicationId,
      merge(this.applications.get(fact.applicationId), fact, ['status', 'decision']),
    );
    return Promise.resolve();
  }

  recordContract(fact: ContractFact): Promise<void> {
    this.contracts.set(
      fact.contractId,
      merge(this.contracts.get(fact.contractId), fact, ['status']),
    );
    return Promise.resolve();
  }

  recordDisbursement(fact: DisbursementFact): Promise<void> {
    this.disbursements.set(
      fact.disbursementId,
      merge(this.disbursements.get(fact.disbursementId), fact, ['status']),
    );
    return Promise.resolve();
  }

  recordCharge(fact: ChargeFact): Promise<void> {
    this.charges.set(
      fact.chargeId,
      merge(this.charges.get(fact.chargeId), fact, ['status', 'failedOn']),
    );
    return Promise.resolve();
  }

  reset(): Promise<void> {
    this.applications.clear();
    this.contracts.clear();
    this.disbursements.clear();
    this.charges.clear();
    return Promise.resolve();
  }

  centerFigures(centerId: string): Promise<CenterFiguresDto> {
    const applications: Tally<ApplicationCountsDto> = {
      submitted: 0,
      approved: 0,
      needsReview: 0,
      rejected: 0,
      offerAccepted: 0,
      cancelled: 0,
      expired: 0,
    };
    const names: Record<string, keyof ApplicationCountsDto> = {
      submitted: 'submitted',
      approved: 'approved',
      needs_review: 'needsReview',
      rejected: 'rejected',
      offer_accepted: 'offerAccepted',
      cancelled: 'cancelled',
      expired: 'expired',
    };
    for (const row of this.applications.values()) {
      const key = row.status ? names[row.status] : undefined;
      if (row.centerId === centerId && key) applications[key] += 1;
    }
    const totals = { contracts: noContracts(), money: noMoney() };
    const products = new Map<Product, typeof totals>([
      ['installments', { contracts: noContracts(), money: noMoney() }],
      ['isa', { contracts: noContracts(), money: noMoney() }],
    ]);
    const targets = (product: Product | undefined) => [
      totals,
      ...(product ? [products.get(product)] : []),
    ];
    const contractNames: Record<string, keyof ContractCountsDto> = {
      active: 'active',
      in_arrears: 'inArrears',
      completed: 'completed',
      defaulted: 'defaulted',
      cancelled: 'cancelled',
    };
    for (const row of this.contracts.values()) {
      const key = row.status ? contractNames[row.status] : undefined;
      if (row.centerId !== centerId || !key) continue;
      for (const target of targets(row.product)) if (target) target.contracts[key] += 1;
    }
    for (const row of this.disbursements.values()) {
      if (row.centerId !== centerId || row.status !== 'settled') continue;
      const product = row.contractId ? this.contracts.get(row.contractId)?.product : undefined;
      for (const target of targets(product)) {
        if (target) target.money.disbursedCents += row.amountCents ?? 0;
      }
    }
    const money: Record<string, keyof MoneyFiguresDto> = {
      paid: 'collectedCents',
      scheduled: 'outstandingCents',
      failed: 'outstandingCents',
      overdue: 'outstandingCents',
      written_off: 'writtenOffCents',
    };
    for (const row of this.charges.values()) {
      const contract = row.contractId ? this.contracts.get(row.contractId) : undefined;
      const key = row.status ? money[row.status] : undefined;
      if ((row.centerId ?? contract?.centerId) !== centerId || !key) continue;
      for (const target of targets(contract?.product)) {
        if (target) target.money[key] += row.amountCents ?? 0;
      }
    }
    return Promise.resolve({
      applications,
      contracts: totals.contracts,
      ...totals.money,
      byProduct: (['installments', 'isa'] as const).map((product) => ({
        product,
        contracts: products.get(product)?.contracts ?? noContracts(),
        ...(products.get(product)?.money ?? noMoney()),
      })),
    });
  }

  programFigures(programId: string): Promise<ProgramFiguresDto> {
    const rows = [...this.applications.values()].filter((row) => row.programId === programId);
    const priced = rows.filter((row) => row.amountCents !== undefined);
    return Promise.resolve({
      applications: rows.length,
      approved: rows.filter((row) => row.decision === 'approved').length,
      rejected: rows.filter((row) => row.decision === 'rejected').length,
      amountCents: priced.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
      pricedApplications: priced.length,
    });
  }

  opsFigures(today: string): Promise<OpsFiguresDto> {
    const count = <R>(rows: Iterable<R>, match: (row: R) => boolean): number =>
      [...rows].filter(match).length;
    return Promise.resolve({
      reviewQueue: count(this.applications.values(), (row) => row.status === 'needs_review'),
      failedChargesToday: count(this.charges.values(), (row) => row.failedOn === today),
      pendingDisbursements: count(
        this.disbursements.values(),
        (row) => row.status === 'pending' || row.status === 'sent',
      ),
      failedDisbursements: count(this.disbursements.values(), (row) => row.status === 'failed'),
      contractsInArrears: count(this.contracts.values(), (row) => row.status === 'in_arrears'),
    });
  }
}

export class FakePrograms implements Programs {
  readonly centers = new Map<string, string>();

  centerOf(programId: string): Promise<string | null> {
    return Promise.resolve(this.centers.get(programId) ?? null);
  }
}

export class FakeProgramScores implements ProgramScores {
  readonly scores = new Map<string, number[]>();

  of(programId: string): Promise<{ scoredApplications: number; averageScore: number | null }> {
    const scores = this.scores.get(programId) ?? [];
    return Promise.resolve({
      scoredApplications: scores.length,
      averageScore:
        scores.length === 0
          ? null
          : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    });
  }
}

export class FakeQueueHealth implements QueueHealth {
  letters = 0;

  deadLetters(): Promise<number> {
    return Promise.resolve(this.letters);
  }
}

export class FakeRebuildJobs implements RebuildJobs {
  readonly requests: (string | null)[] = [];
  busy = false;

  request(requestedBy: string | null): Promise<boolean> {
    if (this.busy) return Promise.resolve(false);
    this.requests.push(requestedBy);
    this.busy = true;
    return Promise.resolve(true);
  }
}

// The history as a list, in order.
export class InMemoryEventHistory implements EventHistory {
  readonly events: IntegrationEvent[] = [];

  read(
    eventTypes: readonly string[],
    afterId: string | null,
    limit: number,
  ): Promise<readonly IntegrationEvent[]> {
    return Promise.resolve(
      this.events
        .filter((event) => eventTypes.includes(event.eventType))
        .filter((event) => !afterId || event.eventId > afterId)
        .slice(0, limit),
    );
  }
}
