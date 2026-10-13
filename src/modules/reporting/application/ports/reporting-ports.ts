import {
  type CenterFiguresDto,
  type OpsFiguresDto,
  type ProgramFiguresDto,
} from '../dto/reporting.dto';

export const REPORTING_STORE = Symbol('REPORTING_STORE');
export const PROGRAMS = Symbol('PROGRAMS');
export const PROGRAM_SCORES = Symbol('PROGRAM_SCORES');
export const QUEUE_HEALTH = Symbol('QUEUE_HEALTH');
export const REBUILD_JOBS = Symbol('REBUILD_JOBS');

export type ApplicationStatus =
  | 'submitted'
  | 'approved'
  | 'needs_review'
  | 'rejected'
  | 'offer_accepted'
  | 'cancelled'
  | 'expired';
export type ContractStatus = 'active' | 'in_arrears' | 'completed' | 'defaulted' | 'cancelled';
export type DisbursementStatus = 'pending' | 'sent' | 'settled' | 'failed';
export type ChargeStatus =
  'scheduled' | 'paid' | 'failed' | 'overdue' | 'written_off' | 'cancelled';
export type Product = 'installments' | 'isa';

// One fact per application, contract, disbursement and charge, built up from the events that
// mention it: each event sets what it knows (an absent field leaves the stored one), and the
// status of the most recent event wins, whatever order events arrive in.
export interface ApplicationFact {
  readonly applicationId: string;
  readonly at: Date;
  // The event it comes from: between two events of the same instant, the later one wins.
  readonly eventId: string;
  readonly centerId?: string;
  readonly programId?: string;
  readonly product?: Product;
  readonly amountCents?: number;
  readonly status?: ApplicationStatus;
  readonly decision?: 'approved' | 'rejected';
}

export interface ContractFact {
  readonly contractId: string;
  readonly at: Date;
  // The event it comes from: between two events of the same instant, the later one wins.
  readonly eventId: string;
  readonly centerId?: string;
  readonly product?: Product;
  readonly principalCents?: number;
  readonly status?: ContractStatus;
}

export interface DisbursementFact {
  readonly disbursementId: string;
  readonly at: Date;
  // The event it comes from: between two events of the same instant, the later one wins.
  readonly eventId: string;
  readonly contractId?: string;
  readonly centerId?: string;
  readonly amountCents?: number;
  readonly status?: DisbursementStatus;
}

export interface ChargeFact {
  readonly chargeId: string;
  readonly at: Date;
  // The event it comes from: between two events of the same instant, the later one wins.
  readonly eventId: string;
  readonly contractId?: string;
  readonly centerId?: string;
  readonly kind?: 'installment' | 'isa' | 'payoff';
  readonly amountCents?: number;
  readonly status?: ChargeStatus;
  // The day (YYYY-MM-DD, UTC) of the last failed collection.
  readonly failedOn?: string;
}

// The read models: written by the projector, read by the dashboards. Writes are upserts that can
// be applied twice; reset() empties every read model for a rebuild, inside its transaction.
export interface ReportingStore {
  recordApplication(fact: ApplicationFact): Promise<void>;
  recordContract(fact: ContractFact): Promise<void>;
  recordDisbursement(fact: DisbursementFact): Promise<void>;
  recordCharge(fact: ChargeFact): Promise<void>;
  reset(): Promise<void>;
  centerFigures(centerId: string): Promise<CenterFiguresDto>;
  programFigures(programId: string): Promise<ProgramFiguresDto>;
  // `today`: YYYY-MM-DD, UTC.
  opsFigures(today: string): Promise<OpsFiguresDto>;
}

// Which center offers a program (catalog), to keep a center to its own programs.
export interface Programs {
  centerOf(programId: string): Promise<string | null>;
}

// How a program's applicants scored, as an aggregate (origination keeps the scores).
export interface ProgramScores {
  of(programId: string): Promise<{
    readonly scoredApplications: number;
    readonly averageScore: number | null;
  }>;
}

// Jobs that ended in the dead-letter queue and are waiting for someone.
export interface QueueHealth {
  deadLetters(): Promise<number>;
}

export interface RebuildJobs {
  // False when a rebuild is already queued or running.
  request(requestedBy: string | null): Promise<boolean>;
}
