import { type CursorPage, type PageRequest } from '@shared/application';
import { type Money, type Percentage } from '@shared/domain';

import {
  type ContractFilter,
  type ContractSummaryDto,
  type DisbursementDto,
  type DisbursementFilter,
} from '../dto/contract.dto';
import { type BillablePlanDto } from '../dto/plan-lookup';

export const E_SIGNATURE_PROVIDER = Symbol('E_SIGNATURE_PROVIDER');
export const BANK_TRANSFER_PROVIDER = Symbol('BANK_TRANSFER_PROVIDER');
export const CONTRACTING_DIRECTORY = Symbol('CONTRACTING_DIRECTORY');
export const CONTRACT_QUERIES = Symbol('CONTRACT_QUERIES');

export interface EnvelopeRequest {
  readonly contractId: string;
  readonly studentId: string;
  readonly document: string;
  readonly documentHash: string;
}

// Sends the contract to the student for an electronic signature. The provider calls back
// (POST /webhooks/esign) when the student signs or declines.
export interface ESignatureProvider {
  readonly name: string;
  // Idempotent by contract: asking twice for one contract gives the same envelope.
  sendEnvelope(request: EnvelopeRequest): Promise<{ readonly envelopeId: string }>;
}

export interface TransferRequest {
  // Same key, same transfer: a repeated call never pays twice.
  readonly idempotencyKey: string;
  readonly amount: Money;
  readonly creditorIban: string;
  readonly creditorName: string;
  // Shown on the center's statement.
  readonly reference: string;
}

export type TransferStatus =
  | { readonly state: 'pending' }
  | { readonly state: 'settled' }
  | { readonly state: 'failed'; readonly reason: string };

// Pays the training centers. A transfer is accepted at once and settles later.
export interface BankTransferProvider {
  transfer(request: TransferRequest): Promise<{ readonly transferId: string }>;
  status(transferId: string): Promise<TransferStatus>;
}

// What lending reads from catalog, through its public queries.
export interface ContractingDirectory {
  // The center's platform fee and the program's length, when the contract is drawn up; null if
  // either is unknown.
  contractingDetails(
    centerId: string,
    programId: string,
  ): Promise<{ readonly platformFee: Percentage; readonly programDurationWeeks: number } | null>;
  // Where the disbursement goes, read when it is made so a corrected IBAN is used on a retry.
  payoutAccount(centerId: string): Promise<{
    readonly iban: string;
    readonly holderName: string;
    readonly centerActive: boolean;
  } | null>;
}

export interface ContractQueries {
  list(filter: ContractFilter, page: PageRequest): Promise<CursorPage<ContractSummaryDto>>;
  listDisbursements(
    filter: DisbursementFilter,
    page: PageRequest,
  ): Promise<CursorPage<DisbursementDto>>;
  // Plans being repaid (plan active, contract active or in arrears), in contract id order.
  billablePlans(afterContractId: string | null, limit: number): Promise<readonly BillablePlanDto[]>;
}
