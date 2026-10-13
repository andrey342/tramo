import { GetProgramScoresQuery } from '../../src/modules/origination/application/dto/program-scores';
import { type ApplicationQueries } from '../../src/modules/origination/application/ports/origination-ports';
import { GetProgramScoresHandler } from '../../src/modules/origination/application/queries/get-program-scores.query';
import {
  type OpsFiguresDto,
  type ProgramFiguresDto,
} from '../../src/modules/reporting/application/dto/reporting.dto';
import {
  type ApplicationFact,
  type ChargeFact,
  type ContractFact,
  type DisbursementFact,
  type Programs,
  type ProgramScores,
  type QueueHealth,
  type RebuildJobs,
  type ReportingStore,
} from '../../src/modules/reporting/application/ports/reporting-ports';
import { type CenterRows, type Product } from '../../src/modules/reporting/domain';
import { type EventHistory, type IntegrationEvent } from '../../src/shared/application';

type Row<F> = Omit<F, 'at' | 'eventId'> & { lastEventAt: Date; lastEventId: string };

interface Rules {
  readonly terminal: readonly string[];
  // Set once, never replaced.
  readonly once?: readonly string[];
  // Kept at their greatest value.
  readonly greatest?: readonly string[];
}

// The same rules as the SQL upserts (see the ReportingStore port).
function merge<F extends { at: Date; eventId: string; status?: string }>(
  existing: Row<F> | undefined,
  fact: F,
  rules: Rules,
): Row<F> {
  const { at, eventId, ...fields } = fact;
  if (!existing) {
    return { ...fields, lastEventAt: at, lastEventId: eventId };
  }
  const newer =
    at.getTime() > existing.lastEventAt.getTime() ||
    (at.getTime() === existing.lastEventAt.getTime() && eventId >= existing.lastEventId);
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(fields) as [string, string | number | undefined][]) {
    if (value === undefined) continue;
    const stored = merged[key] as string | number | undefined;
    if (key === 'status') {
      const keepsFinal =
        rules.terminal.includes(String(stored)) && !rules.terminal.includes(String(value));
      if (newer && !keepsFinal) merged[key] = value;
    } else if (rules.once?.includes(key)) {
      merged[key] = stored ?? value;
    } else if (rules.greatest?.includes(key)) {
      merged[key] = stored === undefined || String(value) > String(stored) ? value : stored;
    } else {
      merged[key] = value;
    }
  }
  merged.lastEventAt = newer ? at : existing.lastEventAt;
  merged.lastEventId = newer ? eventId : existing.lastEventId;
  return merged as Row<F>;
}

function group<R, K extends string>(
  rows: readonly R[],
  key: (row: R) => Record<K, string | null>,
  value: (row: R) => number,
): (Record<K, string | null> & { value: number })[] {
  const groups = new Map<string, Record<K, string | null> & { value: number }>();
  for (const row of rows) {
    const keys = key(row);
    const id = JSON.stringify(keys);
    const current = groups.get(id) ?? { ...keys, value: 0 };
    current.value += value(row);
    groups.set(id, current);
  }
  return [...groups.values()];
}

export class InMemoryReportingStore implements ReportingStore {
  readonly applications = new Map<string, Row<ApplicationFact>>();
  readonly contracts = new Map<string, Row<ContractFact>>();
  readonly disbursements = new Map<string, Row<DisbursementFact>>();
  readonly charges = new Map<string, Row<ChargeFact>>();

  recordApplication(fact: ApplicationFact): Promise<void> {
    this.applications.set(
      fact.applicationId,
      merge(this.applications.get(fact.applicationId), fact, {
        terminal: ['rejected', 'offer_accepted', 'cancelled', 'expired'],
        once: ['decision'],
      }),
    );
    return Promise.resolve();
  }

  recordContract(fact: ContractFact): Promise<void> {
    this.contracts.set(
      fact.contractId,
      merge(this.contracts.get(fact.contractId), fact, {
        terminal: ['completed', 'defaulted', 'cancelled'],
      }),
    );
    return Promise.resolve();
  }

  recordDisbursement(fact: DisbursementFact): Promise<void> {
    this.disbursements.set(
      fact.disbursementId,
      merge(this.disbursements.get(fact.disbursementId), fact, { terminal: ['settled'] }),
    );
    return Promise.resolve();
  }

  recordCharge(fact: ChargeFact): Promise<void> {
    this.charges.set(
      fact.chargeId,
      merge(this.charges.get(fact.chargeId), fact, {
        terminal: ['paid', 'written_off', 'cancelled'],
        greatest: ['failedOn'],
      }),
    );
    return Promise.resolve();
  }

  beginRebuild(): Promise<void> {
    this.applications.clear();
    this.contracts.clear();
    this.disbursements.clear();
    this.charges.clear();
    return Promise.resolve();
  }

  centerRows(centerId: string): Promise<CenterRows> {
    const productOf = (contractId: string | undefined): Product | null =>
      (contractId ? this.contracts.get(contractId)?.product : undefined) ?? null;
    const applications = [...this.applications.values()].filter(
      (row) => row.centerId === centerId && row.programId !== undefined && row.status,
    );
    const contracts = [...this.contracts.values()].filter(
      (row) => row.centerId === centerId && row.status,
    );
    const disbursements = [...this.disbursements.values()].filter(
      (row) => row.centerId === centerId && row.status,
    );
    const charges = [...this.charges.values()].filter(
      (row) =>
        (row.centerId ??
          (row.contractId ? this.contracts.get(row.contractId)?.centerId : undefined)) ===
          centerId && row.status,
    );
    return Promise.resolve({
      applications: group(
        applications,
        (row) => ({ status: row.status ?? null }),
        () => 1,
      ).map((row) => ({ status: row.status ?? '', count: row.value })),
      contracts: group(
        contracts,
        (row) => ({ product: row.product ?? null, status: row.status ?? null }),
        () => 1,
      ).map((row) => ({
        product: row.product as Product | null,
        status: row.status ?? '',
        count: row.value,
      })),
      disbursements: group(
        disbursements,
        (row) => ({ product: productOf(row.contractId), status: row.status ?? null }),
        (row) => row.amountCents ?? 0,
      ).map((row) => ({
        product: row.product as Product | null,
        status: row.status ?? '',
        cents: row.value,
      })),
      charges: group(
        charges,
        (row) => ({
          product: productOf(row.contractId),
          kind: row.kind ?? null,
          status: row.status ?? null,
        }),
        (row) => row.amountCents ?? 0,
      ).map((row) => ({
        product: row.product as Product | null,
        kind: row.kind,
        status: row.status ?? '',
        cents: row.value,
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
      failedChargesToday: count(
        this.charges.values(),
        (row) => row.failedOn === today && (row.status === 'failed' || row.status === 'overdue'),
      ),
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

// Origination's answer, through its own handler: the mean only from ten scored applicants, in
// bands of five (GetProgramScoresHandler), so a test cannot rely on a figure production hides.
export class FakeProgramScores implements ProgramScores {
  readonly scores = new Map<string, number[]>();

  of(programId: string): Promise<{ scoredApplications: number; averageScore: number | null }> {
    const scores = this.scores.get(programId) ?? [];
    const raw = {
      scoredApplications: scores.length,
      averageScore:
        scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    };
    const origination = new GetProgramScoresHandler({
      programScores: () => Promise.resolve(raw),
    } as unknown as ApplicationQueries);
    return origination.execute(new GetProgramScoresQuery(programId));
  }
}

export class FakeQueueHealth implements QueueHealth {
  // null: the queue cannot be read (Redis down).
  letters: number | null = 0;

  deadLetters(): Promise<number | null> {
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

// The history as a list, kept in whatever order it was filled; read in id order like the outbox.
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
        .sort((a, b) => Number(a.eventId > b.eventId) - Number(a.eventId < b.eventId))
        .slice(0, limit),
    );
  }
}
