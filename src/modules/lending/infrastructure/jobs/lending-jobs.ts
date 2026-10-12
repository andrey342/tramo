import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Job, type JobsOptions, type Queue } from 'bullmq';

import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { CheckDisbursementSettlementCommand } from '../../application/commands/check-disbursement-settlement.command';
import { ExecuteDisbursementCommand } from '../../application/commands/execute-disbursement.command';
import { SendContractForSignatureCommand } from '../../application/commands/send-contract-for-signature.command';

export interface SignatureJob extends CorrelatedJobData {
  readonly contractId: string;
}

export interface DisbursementJob extends CorrelatedJobData {
  readonly disbursementId: string;
}

export const JOB_NAMES = {
  sendForSignature: 'contract.send-for-signature',
  transfer: 'disbursement.transfer',
  checkSettlement: 'disbursement.check-settlement',
} as const;

// A provider or bank outage is retried for about two hours (exponential from 30 s over nine
// attempts), then dead-lettered for ops.
const PROVIDER_CALL: JobsOptions = { attempts: 9, backoff: { type: 'exponential', delay: 30_000 } };

// A transfer settles when the bank says so: asked a few seconds after it is sent, then with
// backoff from a minute for about three days (twelve attempts) before ops are left to look.
const SETTLEMENT_CHECK: JobsOptions = {
  delay: 5_000,
  attempts: 12,
  backoff: { type: 'exponential', delay: 60_000 },
};

class TransferNotSettledYet extends Error {
  constructor(disbursementId: string) {
    super(`The transfer of disbursement ${disbursementId} has not settled yet.`);
    this.name = 'TransferNotSettledYet';
  }
}

// Queues the work that calls providers, each keyed so a redelivered event queues nothing new.
@Injectable()
export class LendingJobs {
  constructor(
    @InjectQueue(QueueNames.SIGNATURES) private readonly signatures: Queue<SignatureJob>,
    @InjectQueue(QueueNames.DISBURSEMENTS) private readonly disbursements: Queue<DisbursementJob>,
  ) {}

  async sendForSignature(contractId: string, correlationId: string | null): Promise<void> {
    await this.signatures.add(
      JOB_NAMES.sendForSignature,
      { contractId, correlationId },
      { ...PROVIDER_CALL, jobId: `${contractId}.send` },
    );
  }

  // One transfer per attempt: a retry by ops is a new job.
  async transfer(
    disbursementId: string,
    attempt: number,
    correlationId: string | null,
  ): Promise<void> {
    await this.disbursements.add(
      JOB_NAMES.transfer,
      { disbursementId, correlationId },
      { ...PROVIDER_CALL, jobId: `${disbursementId}.${String(attempt)}.transfer` },
    );
  }

  async checkSettlement(
    disbursementId: string,
    attempt: number,
    correlationId: string | null,
  ): Promise<void> {
    await this.disbursements.add(
      JOB_NAMES.checkSettlement,
      { disbursementId, correlationId },
      { ...SETTLEMENT_CHECK, jobId: `${disbursementId}.${String(attempt)}.settlement` },
    );
  }
}

@Processor(QueueNames.SIGNATURES, { concurrency: 5 })
export class SignatureProcessor extends QueueProcessor<SignatureJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<SignatureJob>): Promise<void> {
    await this.commands.execute(new SendContractForSignatureCommand(job.data.contractId));
  }
}

@Processor(QueueNames.DISBURSEMENTS, { concurrency: 5 })
export class DisbursementProcessor extends QueueProcessor<DisbursementJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<DisbursementJob>): Promise<string> {
    const { disbursementId } = job.data;
    if (job.name === JOB_NAMES.transfer) {
      await this.commands.execute(new ExecuteDisbursementCommand(disbursementId));
      return 'executed';
    }
    const outcome = await this.commands.execute(
      new CheckDisbursementSettlementCommand(disbursementId),
    );
    // Thrown so BullMQ asks again with backoff.
    if (outcome === 'pending') {
      throw new TransferNotSettledYet(disbursementId);
    }
    return outcome;
  }
}
