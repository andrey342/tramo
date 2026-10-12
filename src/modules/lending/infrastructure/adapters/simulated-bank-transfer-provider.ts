import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  type BankTransferProvider,
  type TransferRequest,
  type TransferStatus,
} from '../../application/ports/lending-ports';

// Payout accounts whose number ends in 0000 are closed: the transfer is accepted and then
// bounces, which is how the demo shows a failed disbursement and its retry.
const CLOSED_ACCOUNT = /0000$/;

// Stands in for the bank. Deterministic and stateless, so the api and the worker (or a restarted
// worker) agree: the transfer id derives from the idempotency key, and carries the outcome the
// bank will report for it.
@Injectable()
export class SimulatedBankTransferProvider implements BankTransferProvider {
  transfer(request: TransferRequest): Promise<{ readonly transferId: string }> {
    const outcome = CLOSED_ACCOUNT.test(request.creditorIban.replace(/\s/g, '')) ? 'rej' : 'ok';
    const reference = createHash('sha256')
      .update(request.idempotencyKey)
      .digest('hex')
      .slice(0, 24);
    return Promise.resolve({ transferId: `sim-tr-${outcome}-${reference}` });
  }

  status(transferId: string): Promise<TransferStatus> {
    if (transferId.startsWith('sim-tr-ok-')) {
      return Promise.resolve({ state: 'settled' });
    }
    if (transferId.startsWith('sim-tr-rej-')) {
      return Promise.resolve({ state: 'failed', reason: 'account_closed' });
    }
    return Promise.reject(new Error(`Unknown transfer ${transferId}.`));
  }
}
