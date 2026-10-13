import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type OpsFiguresDto, type ProgramFiguresDto } from '../../application/dto/reporting.dto';
import {
  type ApplicationFact,
  type ChargeFact,
  type ContractFact,
  type DisbursementFact,
  type ReportingStore,
} from '../../application/ports/reporting-ports';
import { type CenterRows, type Product } from '../../domain';

type Value = string | number | null;

interface Upsert {
  readonly table: string;
  readonly key: string;
  // The same in every event that carries them: an absent one leaves the stored value.
  readonly descriptive: readonly string[];
  // Final statuses, never replaced by one that is not.
  readonly terminal: readonly string[];
  // Columns with a rule of their own (written as SQL against t and EXCLUDED).
  readonly special?: Readonly<Record<string, string>>;
}

// An upsert that can be applied twice and in any order (see the ReportingStore port): the status
// follows the most recent event by (time, event id), unless the stored one is final and the new
// one is not.
function upsertSql({ table, key, descriptive, terminal, special = {} }: Upsert): string {
  const columns = [key, ...descriptive, 'status', ...Object.keys(special)];
  const newer =
    '(EXCLUDED.last_event_at, EXCLUDED.last_event_id) >= (t.last_event_at, t.last_event_id)';
  const final = terminal.map((status) => `'${status}'`).join(', ');
  const sets = [
    ...descriptive.map((column) => `${column} = COALESCE(EXCLUDED.${column}, t.${column})`),
    `status = CASE
       WHEN EXCLUDED.status IS NULL OR NOT ${newer} THEN t.status
       WHEN t.status IN (${final}) AND EXCLUDED.status NOT IN (${final}) THEN t.status
       ELSE EXCLUDED.status END`,
    ...Object.entries(special).map(([column, rule]) => `${column} = ${rule}`),
    `last_event_id = CASE WHEN ${newer} THEN EXCLUDED.last_event_id ELSE t.last_event_id END`,
    'last_event_at = GREATEST(t.last_event_at, EXCLUDED.last_event_at)',
  ];
  const all = [...columns, 'last_event_at', 'last_event_id'];
  return `INSERT INTO reporting.${table} AS t (${all.join(', ')})
    VALUES (${all.map((_, index) => `$${String(index + 1)}`).join(', ')})
    ON CONFLICT (${key}) DO UPDATE SET ${sets.join(', ')}`;
}

const APPLICATION_UPSERT = upsertSql({
  table: 'application_facts',
  key: 'application_id',
  descriptive: ['center_id', 'program_id', 'product', 'amount_cents'],
  terminal: ['rejected', 'offer_accepted', 'cancelled', 'expired'],
  // Origination decides once.
  special: { decision: 'COALESCE(t.decision, EXCLUDED.decision)' },
});
const CONTRACT_UPSERT = upsertSql({
  table: 'contract_facts',
  key: 'contract_id',
  descriptive: ['center_id', 'product', 'principal_cents'],
  terminal: ['completed', 'defaulted', 'cancelled'],
});
const DISBURSEMENT_UPSERT = upsertSql({
  table: 'disbursement_facts',
  key: 'disbursement_id',
  descriptive: ['contract_id', 'center_id', 'amount_cents'],
  terminal: ['settled'],
});
const CHARGE_UPSERT = upsertSql({
  table: 'charge_facts',
  key: 'charge_id',
  descriptive: ['contract_id', 'center_id', 'kind', 'amount_cents'],
  terminal: ['paid', 'written_off', 'cancelled'],
  special: { failed_on: 'GREATEST(t.failed_on, EXCLUDED.failed_on)' },
});

const FACT_TABLES = [
  'reporting.application_facts',
  'reporting.contract_facts',
  'reporting.disbursement_facts',
  'reporting.charge_facts',
];

const none = (value: unknown): Value => (value === undefined ? null : (value as Value));
// Postgres answers counts and sums of bigint as strings.
const number = (value: unknown): number => Number(value ?? 0);

// The read models in the reporting schema. Writes run in the caller's unit of work; the figures
// are grouped at read time, each query served by an index on the center or the program.
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

  // The first statements of the rebuild's transaction: one snapshot for the whole replay, and an
  // EXCLUSIVE lock, which keeps the consumers' writes out but not the dashboards' reads (they
  // see the old facts until the commit). DELETE, not TRUNCATE: TRUNCATE would lock readers out.
  async beginRebuild(): Promise<void> {
    const tx = this.txHost.tx;
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await tx.query(`LOCK TABLE ${FACT_TABLES.join(', ')} IN EXCLUSIVE MODE`);
    for (const table of FACT_TABLES) {
      await tx.query(`DELETE FROM ${table}`);
    }
  }

  async centerRows(centerId: string): Promise<CenterRows> {
    const tx = this.txHost.tx;
    // Applications in the funnel are those submitted: a draft has no program in its facts.
    const applications = await tx.query<{ status: string; total: string }[]>(
      `SELECT status, COUNT(*) AS total FROM reporting.application_facts
        WHERE center_id = $1 AND program_id IS NOT NULL AND status IS NOT NULL
        GROUP BY status`,
      [centerId],
    );
    const contracts = await tx.query<{ product: Product | null; status: string; total: string }[]>(
      `SELECT product, status, COUNT(*) AS total FROM reporting.contract_facts
        WHERE center_id = $1 AND status IS NOT NULL
        GROUP BY product, status`,
      [centerId],
    );
    const disbursements = await tx.query<
      { product: Product | null; status: string; total: string | null }[]
    >(
      `SELECT k.product, d.status, SUM(d.amount_cents) AS total
         FROM reporting.disbursement_facts d
         LEFT JOIN reporting.contract_facts k ON k.contract_id = d.contract_id
        WHERE d.center_id = $1 AND d.status IS NOT NULL
        GROUP BY k.product, d.status`,
      [centerId],
    );
    // A charge whose events never named the center (only a failure arrived yet) is placed by its
    // contract's.
    const charges = await tx.query<
      { product: Product | null; kind: string | null; status: string; total: string | null }[]
    >(
      `SELECT k.product, c.kind, c.status, SUM(c.amount_cents) AS total
         FROM reporting.charge_facts c
         LEFT JOIN reporting.contract_facts k ON k.contract_id = c.contract_id
        WHERE (c.center_id = $1 OR (c.center_id IS NULL AND k.center_id = $1))
          AND c.status IS NOT NULL
        GROUP BY k.product, c.kind, c.status`,
      [centerId],
    );
    return {
      applications: applications.map((row) => ({ status: row.status, count: number(row.total) })),
      contracts: contracts.map((row) => ({
        product: row.product,
        status: row.status,
        count: number(row.total),
      })),
      disbursements: disbursements.map((row) => ({
        product: row.product,
        status: row.status,
        cents: number(row.total),
      })),
      charges: charges.map((row) => ({
        product: row.product,
        kind: row.kind,
        status: row.status,
        cents: number(row.total),
      })),
    };
  }

  async programFigures(programId: string): Promise<ProgramFiguresDto> {
    const [row] = await this.txHost.tx.query<
      {
        total: string;
        approved: string;
        rejected: string;
        amount: string | null;
        priced: string;
      }[]
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
      applications: number(row?.total),
      approved: number(row?.approved),
      rejected: number(row?.rejected),
      amountCents: number(row?.amount),
      pricedApplications: number(row?.priced),
    };
  }

  async opsFigures(today: string): Promise<OpsFiguresDto> {
    const [row] = await this.txHost.tx.query<Record<string, string>[]>(
      `SELECT
         (SELECT COUNT(*) FROM reporting.application_facts
           WHERE status = 'needs_review') AS review_queue,
         (SELECT COUNT(*) FROM reporting.charge_facts
           WHERE failed_on = $1 AND status IN ('failed', 'overdue')) AS failed_charges_today,
         (SELECT COUNT(*) FROM reporting.disbursement_facts
           WHERE status IN ('pending', 'sent')) AS pending_disbursements,
         (SELECT COUNT(*) FROM reporting.disbursement_facts
           WHERE status = 'failed') AS failed_disbursements,
         (SELECT COUNT(*) FROM reporting.contract_facts
           WHERE status = 'in_arrears') AS contracts_in_arrears`,
      [today],
    );
    return {
      reviewQueue: number(row?.review_queue),
      failedChargesToday: number(row?.failed_charges_today),
      pendingDisbursements: number(row?.pending_disbursements),
      failedDisbursements: number(row?.failed_disbursements),
      contractsInArrears: number(row?.contracts_in_arrears),
    };
  }
}
