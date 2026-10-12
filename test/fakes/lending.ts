import {
  type ContractFilter,
  type ContractSummaryDto,
  type DisbursementDto,
  type DisbursementFilter,
} from '../../src/modules/lending/application/dto/contract.dto';
import {
  type BankTransferProvider,
  type ContractingDirectory,
  type ContractQueries,
  type EnvelopeRequest,
  type ESignatureProvider,
  type TransferRequest,
  type TransferStatus,
} from '../../src/modules/lending/application/ports/lending-ports';
import {
  type Contract,
  type ContractRepository,
  type Disbursement,
  type DisbursementRepository,
  type FinancingPlan,
  type FinancingPlanRepository,
  LendingRecordExistsError,
} from '../../src/modules/lending/domain';
import { type CursorPage, type PageRequest } from '../../src/shared/application';
import { Percentage } from '../../src/shared/domain';
import { decodeCursor, encodeCursor } from '../../src/shared/infrastructure/database';

import { InMemoryRepository } from './shared';

export class InMemoryContractRepository
  extends InMemoryRepository<Contract>
  implements ContractRepository
{
  findByApplicationId(applicationId: string): Promise<Contract | null> {
    return Promise.resolve(
      this.all().find((contract) => contract.applicationId === applicationId) ?? null,
    );
  }

  findByEnvelopeId(envelopeId: string): Promise<Contract | null> {
    return Promise.resolve(
      this.all().find((contract) => contract.signature?.envelopeId === envelopeId) ?? null,
    );
  }

  override async save(contract: Contract): Promise<void> {
    const other = await this.findByApplicationId(contract.applicationId);
    if (other && other.id !== contract.id) {
      throw new LendingRecordExistsError('Contract', 'application', contract.applicationId);
    }
    await super.save(contract);
  }
}

export class InMemoryDisbursementRepository
  extends InMemoryRepository<Disbursement>
  implements DisbursementRepository
{
  findByContractId(contractId: string): Promise<Disbursement | null> {
    return Promise.resolve(this.all().find((item) => item.contractId === contractId) ?? null);
  }

  override async save(disbursement: Disbursement): Promise<void> {
    const other = await this.findByContractId(disbursement.contractId);
    if (other && other.id !== disbursement.id) {
      throw new LendingRecordExistsError('Disbursement', 'contract', disbursement.contractId);
    }
    await super.save(disbursement);
  }
}

export class InMemoryFinancingPlanRepository
  extends InMemoryRepository<FinancingPlan>
  implements FinancingPlanRepository
{
  findByContractId(contractId: string): Promise<FinancingPlan | null> {
    return Promise.resolve(this.all().find((plan) => plan.contractId === contractId) ?? null);
  }

  override async save(plan: FinancingPlan): Promise<void> {
    const other = await this.findByContractId(plan.contractId);
    if (other && other.id !== plan.id) {
      throw new LendingRecordExistsError('FinancingPlan', 'contract', plan.contractId);
    }
    await super.save(plan);
  }
}

// Newest first by (createdAt, id), like the keyset pagination of the real queries.
function page<T extends { id: string; createdAt: Date }>(
  items: readonly T[],
  request: PageRequest,
): CursorPage<T> {
  const sorted = [...items].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  );
  const cursor = request.cursor ? decodeCursor(request.cursor) : null;
  const after = cursor
    ? sorted.filter(
        (item) =>
          item.createdAt.toISOString() < cursor.sortValue ||
          (item.createdAt.toISOString() === cursor.sortValue && item.id < cursor.id),
      )
    : sorted;
  const data = after.slice(0, request.limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      after.length > request.limit && last
        ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export class InMemoryContractQueries implements ContractQueries {
  constructor(
    private readonly contracts: InMemoryContractRepository,
    private readonly disbursements: InMemoryDisbursementRepository,
  ) {}

  list(filter: ContractFilter, request: PageRequest): Promise<CursorPage<ContractSummaryDto>> {
    const matching = this.contracts
      .all()
      .filter(
        (contract) =>
          (!filter.studentId || contract.studentId === filter.studentId) &&
          (!filter.centerId || contract.centerId === filter.centerId) &&
          (!filter.status || contract.status === filter.status),
      )
      .map((contract): ContractSummaryDto => ({
        id: contract.id,
        applicationId: contract.applicationId,
        studentId: contract.studentId,
        centerId: contract.centerId,
        programName: contract.program.name,
        principalCents: contract.terms.principal.cents,
        product: contract.terms.product.kind,
        status: contract.status,
        statusChangedAt: contract.statusChangedAt,
        createdAt: contract.createdAt,
      }));
    return Promise.resolve(page(matching, request));
  }

  listDisbursements(
    filter: DisbursementFilter,
    request: PageRequest,
  ): Promise<CursorPage<DisbursementDto>> {
    const matching = this.disbursements
      .all()
      .filter((item) => !filter.status || item.status === filter.status)
      .map((item): DisbursementDto => ({
        id: item.id,
        contractId: item.contractId,
        centerId: item.centerId,
        amountCents: item.amount.cents,
        attempt: item.attempt,
        status: item.status,
        failureReason: item.failureReason,
        statusChangedAt: item.statusChangedAt,
        settledAt: item.settledAt,
        createdAt: item.createdAt,
      }));
    return Promise.resolve(page(matching, request));
  }
}

export class FakeESignatureProvider implements ESignatureProvider {
  readonly name = 'fake';
  readonly sent: EnvelopeRequest[] = [];
  failWith: Error | null = null;

  sendEnvelope(request: EnvelopeRequest): Promise<{ readonly envelopeId: string }> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.sent.push(request);
    return Promise.resolve({ envelopeId: `fake-env-${request.contractId}` });
  }
}

export const OPEN_IBAN = 'ES9121000418450200051332';
export const CLOSED_IBAN = 'ES1421000418401234560000';

// Remembers transfers by idempotency key. A transfer to an IBAN ending in 0000 bounces; one to
// any other account settles, or stays pending while `settleImmediately` is off.
export class FakeBankTransferProvider implements BankTransferProvider {
  readonly transfers = new Map<string, TransferRequest & { transferId: string }>();
  settleImmediately = true;
  failWith: Error | null = null;

  transfer(request: TransferRequest): Promise<{ readonly transferId: string }> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    const existing = this.transfers.get(request.idempotencyKey);
    if (existing) {
      return Promise.resolve({ transferId: existing.transferId });
    }
    const transferId = `fake-tr-${String(this.transfers.size + 1)}`;
    this.transfers.set(request.idempotencyKey, { ...request, transferId });
    return Promise.resolve({ transferId });
  }

  status(transferId: string): Promise<TransferStatus> {
    const transfer = [...this.transfers.values()].find((item) => item.transferId === transferId);
    if (!transfer) {
      return Promise.reject(new Error(`Unknown transfer ${transferId}.`));
    }
    if (transfer.creditorIban.endsWith('0000')) {
      return Promise.resolve({ state: 'failed', reason: 'account_closed' });
    }
    return Promise.resolve({ state: this.settleImmediately ? 'settled' : 'pending' });
  }
}

interface FakeCenter {
  readonly platformFeeBasisPoints: number;
  readonly iban: string;
  readonly active: boolean;
}

export class FakeContractingDirectory implements ContractingDirectory {
  readonly centers = new Map<string, FakeCenter>();
  readonly programs = new Map<string, { centerId: string; durationWeeks: number }>();

  addCenter(centerId: string, center: Partial<FakeCenter> = {}): this {
    this.centers.set(centerId, {
      platformFeeBasisPoints: 500,
      iban: OPEN_IBAN,
      active: true,
      ...center,
    });
    return this;
  }

  addProgram(programId: string, centerId: string, durationWeeks = 12): this {
    this.programs.set(programId, { centerId, durationWeeks });
    return this;
  }

  contractingDetails(
    centerId: string,
    programId: string,
  ): Promise<{ readonly platformFee: Percentage; readonly programDurationWeeks: number } | null> {
    const center = this.centers.get(centerId);
    const program = this.programs.get(programId);
    return Promise.resolve(
      center && program?.centerId === centerId
        ? {
            platformFee: Percentage.fromBasisPoints(center.platformFeeBasisPoints),
            programDurationWeeks: program.durationWeeks,
          }
        : null,
    );
  }

  payoutAccount(centerId: string): Promise<{
    readonly iban: string;
    readonly holderName: string;
    readonly centerActive: boolean;
  } | null> {
    const center = this.centers.get(centerId);
    return Promise.resolve(
      center
        ? { iban: center.iban, holderName: 'Codeworks Madrid', centerActive: center.active }
        : null,
    );
  }
}
