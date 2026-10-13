import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import {
  type ApplicationCountsDto,
  type CenterFiguresDto,
  type ContractCountsDto,
  type MoneyFiguresDto,
  type OpsFiguresDto,
  type ProductFiguresDto,
  type ProgramFiguresDto,
} from '../../application/dto/reporting.dto';
import {
  type ApplicationFact,
  type ChargeFact,
  type ContractFact,
  type DisbursementFact,
  type Product,
  type ReportingStore,
} from '../../application/ports/reporting-ports';

type Value = string | number | null;

// An upsert that can be applied twice and in any order: descriptive columns keep what an event
// did not say (COALESCE); status columns, and the last event, follow the most recent event by
// (time, event id).
function upsertSql(
  table: string,
  key: string,
  descriptive: readonly string[],
  statuses: readonly string[],
): string {
  const columns = [key, ...descriptive, ...statuses, 'last_event_at', 'last_event_id'];
  const newer =
    '(EXCLUDED.last_event_at, EXCLUDED.last_event_id) >= (t.last_event_at, t.last_event_id)';
  const sets = [
    ...descriptive.map((column) => `${column} = COALESCE(EXCLUDED.${column}, t.${column})`),
    ...statuses.map(
      (column) =>
        `${column} = CASE WHEN EXCLUDED.${column} IS NOT NULL AND ${newer} THEN EXCLUDED.${column} ELSE t.${column} END`,
    ),
    `last_event_id = CASE WHEN ${newer} THEN EXCLUDED.last_event_id ELSE t.last_event_id END`,
    'last_event_at = GREATEST(t.last_event_at, EXCLUDED.last_event_at)',
  ];
  return `INSERT INTO reporting.${table} AS t (${columns.join(', ')})
    VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')})
    ON CONFLICT (${key}) DO UPDATE SET ${sets.join(', ')}`;
}

const APPLICATION_UPSERT = upsertSql(
  'application_facts',
  'application_id',
  ['center_id', 'program_id', 'product', 'amount_cents'],
  ['status', 'decision'],
);
const CONTRACT_UPSERT = upsertSql(
  'contract_facts',
  'contract_id',
  ['center_id', 'product', 'principal_cents'],
  ['status'],
);
const DISBURSEMENT_UPSERT = upsertSql(
  'disbursement_facts',
  'disbursement_id',
  ['contract_id', 'center_id', 'amount_cents'],
  ['status'],
);
const CHARGE_UPSERT = upsertSql(
  'charge_facts',
  'charge_id',
  ['contract_id', 'center_id', 'kind', 'amount_cents'],
  ['status', 'failed_on'],
);

const PRODUCTS: readonly Product[] = ['installments', 'isa'];

const none = (value: unknown): Value => (value === undefined ? null : (value as Value));
// Postgres answers counts and sums of bigint as strings.
const count = (value: unknown): number => Number(value ?? 0);

// Counters filled in place while the rows are read.
type Tally<T> = { -readonly [K in keyof T]: T[K] };

function noContracts(): Tally<ContractCountsDto> {
  return { active: 0, inArrears: 0, completed: 0, defaulted: 0, cancelled: 0 };
}

function noMoney(): Tally<MoneyFiguresDto> {
  return { disbursedCents: 0, collectedCents: 0, outstandingCents: 0, writtenOffCents: 0 };
}

const CONTRACT_COUNT: Readonly<Record<string, keyof ContractCountsDto>> = {
  active: 'active',
  in_arrears: 'inArrears',
  completed: 'completed',
  defaulted: 'defaulted',
  cancelled: 'cancelled',
};

const APPLICATION_COUNT: Readonly<Record<string, keyof ApplicationCountsDto>> = {
  submitted: 'submitted',
  approved: 'approved',
  needs_review: 'needsReview',
  rejected: 'rejected',
  offer_accepted: 'offerAccepted',
  cancelled: 'cancelled',
  expired: 'expired',
};

const CHARGE_MONEY: Readonly<Record<string, keyof MoneyFiguresDto>> = {
  paid: 'collectedCents',
  scheduled: 'outstandingCents',
  failed: 'outstandingCents',
  overdue: 'outstandingCents',
  written_off: 'writtenOffCents',
};

// The read models in the reporting schema. Writes run in the caller's unit of work; the figures
// are computed from the facts at read time (a center has thousands of rows at most, each query is
// served by the center or program index).
@Injectable()
export class TypeOrmReportingStore implements ReportingStore {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async recordApplication(fact: ApplicationFact): Promise<void> {
    await this.txHost.tx.query(APPLICATION_UPSERT, [
      fact.applicationId,
      none(fact.centerId),
      none(fact.programId),
      none(fact.product),
      none(fact.amountCents),
      none(fact.status),
      none(fact.decision),
      fact.at,
      fact.eventId,
    ]);
  }

  async recordContract(fact: ContractFact): Promise<void> {
    await this.txHost.tx.query(CONTRACT_UPSERT, [
      fact.contractId,
      none(fact.centerId),
      none(fact.product),
      none(fact.principalCents),
      none(fact.status),
      fact.at,
      fact.eventId,
    ]);
  }

  async recordDisbursement(fact: DisbursementFact): Promise<void> {
    await this.txHost.tx.query(DISBURSEMENT_UPSERT, [
      fact.disbursementId,
      none(fact.contractId),
      none(fact.centerId),
      none(fact.amountCents),
      none(fact.status),
      fact.at,
      fact.eventId,
    ]);
  }

  async recordCharge(fact: ChargeFact): Promise<void> {
    await this.txHost.tx.query(CHARGE_UPSERT, [
      fact.chargeId,
      none(fact.contractId),
      none(fact.centerId),
      none(fact.kind),
      none(fact.amountCents),
      none(fact.status),
      none(fact.failedOn),
      fact.at,
      fact.eventId,
    ]);
  }

  // Takes the tables' locks until the rebuild commits: live consumers wait for it.
  async reset(): Promise<void> {
    await this.txHost.tx.query(
      `TRUNCATE reporting.application_facts, reporting.contract_facts,
                reporting.disbursement_facts, reporting.charge_facts`,
    );
  }

  async centerFigures(centerId: string): Promise<CenterFiguresDto> {
    const tx = this.txHost.tx;
    const [applications, contracts, disbursed, charges] = await Promise.all([
      tx.query<{ status: string | null; total: string }[]>(
        `SELECT status, COUNT(*) AS total FROM reporting.application_facts
          WHERE center_id = $1 GROUP BY status`,
        [centerId],
      ),
      tx.query<{ product: Product | null; status: string | null; total: string }[]>(
        `SELECT product, status, COUNT(*) AS total FROM reporting.contract_facts
          WHERE center_id = $1 GROUP BY product, status`,
        [centerId],
      ),
      tx.query<{ product: Product | null; total: string | null }[]>(
        `SELECT k.product, SUM(d.amount_cents) AS total
           FROM reporting.disbursement_facts d
           LEFT JOIN reporting.contract_facts k ON k.contract_id = d.contract_id
          WHERE d.center_id = $1 AND d.status = 'settled'
          GROUP BY k.product`,
        [centerId],
      ),
      // A charge event without the center (a failure) is placed by its contract's.
      tx.query<{ product: Product | null; status: string | null; total: string | null }[]>(
        `SELECT k.product, c.status, SUM(c.amount_cents) AS total
           FROM reporting.charge_facts c
           LEFT JOIN reporting.contract_facts k ON k.contract_id = c.contract_id
          WHERE COALESCE(c.center_id, k.center_id) = $1
          GROUP BY k.product, c.status`,
        [centerId],
      ),
    ]);
    const applicationCounts: Record<keyof ApplicationCountsDto, number> = {
      submitted: 0,
      approved: 0,
      needsReview: 0,
      rejected: 0,
      offerAccepted: 0,
      cancelled: 0,
      expired: 0,
    };
    for (const row of applications) {
      const key = row.status ? APPLICATION_COUNT[row.status] : undefined;
      if (key) applicationCounts[key] += count(row.total);
    }
    const totals = { contracts: noContracts(), money: noMoney() };
    const byProduct = new Map(
      PRODUCTS.map((product) => [product, { contracts: noContracts(), money: noMoney() }]),
    );
    type Target = (typeof totals)[];
    const into = (product: Product | null): (Target[number] | undefined)[] => [
      totals,
      ...(product ? [byProduct.get(product)] : []),
    ];
    for (const row of contracts) {
      const key = row.status ? CONTRACT_COUNT[row.status] : undefined;
      for (const target of into(row.product)) {
        if (key && target) target.contracts[key] += count(row.total);
      }
    }
    for (const row of disbursed) {
      for (const target of into(row.product)) {
        if (target) target.money.disbursedCents += count(row.total);
      }
    }
    for (const row of charges) {
      const key = row.status ? CHARGE_MONEY[row.status] : undefined;
      for (const target of into(row.product)) {
        if (key && target) target.money[key] += count(row.total);
      }
    }
    return {
      applications: applicationCounts,
      contracts: totals.contracts,
      ...totals.money,
      byProduct: PRODUCTS.map((product): ProductFiguresDto => ({
        product,
        contracts: byProduct.get(product)?.contracts ?? noContracts(),
        ...(byProduct.get(product)?.money ?? noMoney()),
      })),
    };
  }

  async programFigures(programId: string): Promise<ProgramFiguresDto> {
    const [row] = await this.txHost.tx.query<
      { total: string; approved: string; rejected: string; amount: string | null; priced: string }[]
    >(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE decision = 'approved') AS approved,
              COUNT(*) FILTER (WHERE decision = 'rejected') AS rejected,
              SUM(amount_cents) AS amount,
              COUNT(amount_cents) AS priced
         FROM reporting.application_facts
        WHERE program_id = $1`,
      [programId],
    );
    return {
      applications: count(row?.total),
      approved: count(row?.approved),
      rejected: count(row?.rejected),
      amountCents: count(row?.amount),
      pricedApplications: count(row?.priced),
    };
  }

  async opsFigures(today: string): Promise<OpsFiguresDto> {
    const [row] = await this.txHost.tx.query<Record<string, string>[]>(
      `SELECT
         (SELECT COUNT(*) FROM reporting.application_facts WHERE status = 'needs_review') AS review_queue,
         (SELECT COUNT(*) FROM reporting.charge_facts WHERE failed_on = $1) AS failed_charges_today,
         (SELECT COUNT(*) FROM reporting.disbursement_facts WHERE status IN ('pending', 'sent')) AS pending_disbursements,
         (SELECT COUNT(*) FROM reporting.disbursement_facts WHERE status = 'failed') AS failed_disbursements,
         (SELECT COUNT(*) FROM reporting.contract_facts WHERE status = 'in_arrears') AS contracts_in_arrears`,
      [today],
    );
    return {
      reviewQueue: count(row?.review_queue),
      failedChargesToday: count(row?.failed_charges_today),
      pendingDisbursements: count(row?.pending_disbursements),
      failedDisbursements: count(row?.failed_disbursements),
      contractsInArrears: count(row?.contracts_in_arrears),
    };
  }
}
