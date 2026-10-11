import {
  type ApplicationFilter,
  type ApplicationSummaryDto,
} from '../../src/modules/origination/application/dto/application.dto';
import {
  type ApplicationQueries,
  type ProgramDirectory,
  type StudentDirectory,
  type KycProvider,
  type Applicant,
  type EmploymentHistoryProvider,
  type CreditBureau,
} from '../../src/modules/origination/application/ports/origination-ports';
import {
  type FinancingApplication,
  type FinancingApplicationRepository,
  type ProgramSnapshot,
  type RiskPolicy,
  type RiskPolicyRepository,
  type KycResult,
  type EmploymentResult,
  type BureauResult,
} from '../../src/modules/origination/domain';
import { type CursorPage, type PageRequest } from '../../src/shared/application';
import {
  ConcurrentModificationError,
  Money,
  type NationalId,
  Percentage,
} from '../../src/shared/domain';
import { decodeCursor, encodeCursor } from '../../src/shared/infrastructure/database';

import { InMemoryRepository } from './shared';

export class InMemoryFinancingApplicationRepository
  extends InMemoryRepository<FinancingApplication>
  implements FinancingApplicationRepository
{
  findStaleIds(before: Date, limit: number): Promise<string[]> {
    return Promise.resolve(
      this.all()
        .filter((application) => !application.isFinal && application.statusChangedAt < before)
        .sort((a, b) => a.statusChangedAt.getTime() - b.statusChangedAt.getTime())
        .slice(0, limit)
        .map((application) => application.id),
    );
  }
}

export class InMemoryRiskPolicyRepository implements RiskPolicyRepository {
  private readonly versions = new Map<number, RiskPolicy>();

  constructor(initial: readonly RiskPolicy[] = []) {
    for (const policy of initial) this.versions.set(policy.version, policy);
  }

  findCurrent(): Promise<RiskPolicy | null> {
    const latest = Math.max(0, ...this.versions.keys());
    return Promise.resolve(this.versions.get(latest) ?? null);
  }

  findByVersion(version: number): Promise<RiskPolicy | null> {
    return Promise.resolve(this.versions.get(version) ?? null);
  }

  add(policy: RiskPolicy): Promise<void> {
    if (this.versions.has(policy.version)) {
      return Promise.reject(new ConcurrentModificationError('RiskPolicy', String(policy.version)));
    }
    this.versions.set(policy.version, policy);
    return Promise.resolve();
  }
}

const summaryOf = (application: FinancingApplication): ApplicationSummaryDto => ({
  id: application.id,
  applicantId: application.applicantId,
  centerId: application.centerId,
  programId: application.program.programId,
  programName: application.program.name,
  amountCents: application.program.price.cents,
  product: application.product.kind,
  status: application.status,
  score: application.decision?.score ?? null,
  statusChangedAt: application.statusChangedAt,
  createdAt: application.createdAt,
});

// Same answers as the SQL read model (the ApplicationQueries contract runs on both).
export class InMemoryApplicationQueries implements ApplicationQueries {
  constructor(private readonly applications: InMemoryFinancingApplicationRepository) {}

  list(filter: ApplicationFilter, page: PageRequest): Promise<CursorPage<ApplicationSummaryDto>> {
    const matching = this.applications
      .all()
      .filter(
        (application) =>
          (!filter.applicantId || application.applicantId === filter.applicantId) &&
          (!filter.centerId || application.centerId === filter.centerId) &&
          (!filter.status || application.status === filter.status),
      )
      .map(summaryOf);
    return Promise.resolve(paginate(matching, page, 'createdAt', 'desc'));
  }

  reviewQueue(page: PageRequest): Promise<CursorPage<ApplicationSummaryDto>> {
    const waiting = this.applications
      .all()
      .filter((application) => application.status === 'needs_review')
      .map(summaryOf);
    return Promise.resolve(paginate(waiting, page, 'statusChangedAt', 'asc'));
  }
}

function paginate(
  rows: ApplicationSummaryDto[],
  page: PageRequest,
  sortBy: 'createdAt' | 'statusChangedAt',
  direction: 'asc' | 'desc',
): CursorPage<ApplicationSummaryDto> {
  const key = (row: ApplicationSummaryDto): [string, string] => [row[sortBy].toISOString(), row.id];
  const sign = direction === 'asc' ? 1 : -1;
  const compare = (a: [string, string], b: [string, string]): number =>
    sign * (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]));
  const position = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
  const sorted = rows
    .sort((a, b) => compare(key(a), key(b)))
    .filter((row) => !position || compare(key(row), [position.sortValue, position.id]) > 0);
  const data = sorted.slice(0, page.limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      sorted.length > page.limit && last
        ? encodeCursor({ sortValue: key(last)[0], id: last.id })
        : null,
  };
}

export class FakeProgramDirectory implements ProgramDirectory {
  private readonly programs = new Map<string, ProgramSnapshot>();

  constructor(programs: readonly ProgramSnapshot[] = []) {
    for (const program of programs) this.open(program);
  }

  open(program: ProgramSnapshot): void {
    this.programs.set(program.programId, program);
  }

  close(programId: string): void {
    this.programs.delete(programId);
  }

  findOpenProgram(programId: string): Promise<ProgramSnapshot | null> {
    return Promise.resolve(this.programs.get(programId) ?? null);
  }
}

export class FakeStudentDirectory implements StudentDirectory {
  constructor(private readonly students: Readonly<Record<string, string>> = {}) {}

  findStudentId(email: string): Promise<string | null> {
    return Promise.resolve(this.students[email.trim().toLowerCase()] ?? null);
  }
}

// The provider fakes follow the simulated providers' table (9 fails KYC, 7 is in a default
// registry) with fixed values, and let a test set the answer for one applicant.
export class FakeKycProvider implements KycProvider {
  private readonly answers = new Map<string, KycResult>();

  answer(nationalId: string, result: KycResult): void {
    this.answers.set(nationalId, result);
  }

  verifyIdentity(applicant: Applicant): Promise<KycResult> {
    const verified = applicant.nationalId.lastDigit !== 9;
    return Promise.resolve(
      this.answers.get(applicant.nationalId.value) ?? {
        verified,
        confidence: Percentage.fromPercent(verified ? 95 : 35),
        reasons: verified ? [] : ['document_mismatch'],
        provider: 'fake',
      },
    );
  }
}

export class FakeEmploymentHistoryProvider implements EmploymentHistoryProvider {
  private readonly answers = new Map<string, EmploymentResult>();
  readonly asked: string[] = [];

  answer(nationalId: string, result: EmploymentResult): void {
    this.answers.set(nationalId, result);
  }

  fetch(nationalId: NationalId): Promise<EmploymentResult> {
    this.asked.push(nationalId.value);
    return Promise.resolve(
      this.answers.get(nationalId.value) ?? {
        monthsWorkedLast24: 24,
        currentlyEmployed: true,
        currentMonthlyIncome: Money.fromCents(1_800_00),
        provider: 'fake',
      },
    );
  }
}

export class FakeCreditBureau implements CreditBureau {
  private readonly answers = new Map<string, BureauResult>();

  answer(nationalId: string, result: BureauResult): void {
    this.answers.set(nationalId, result);
  }

  check(nationalId: NationalId): Promise<BureauResult> {
    const listed = nationalId.lastDigit === 7;
    return Promise.resolve(
      this.answers.get(nationalId.value) ?? {
        listedInDefaultRegistry: listed,
        score: listed ? 200 : 800,
        provider: 'fake',
      },
    );
  }
}
