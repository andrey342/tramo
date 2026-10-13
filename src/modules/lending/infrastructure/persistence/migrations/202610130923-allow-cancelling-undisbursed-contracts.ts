import { type MigrationInterface, type QueryRunner } from 'typeorm';

const LIVE = `'active', 'in_arrears', 'completed', 'defaulted'`;

// Signed by the student: a contract that took effect, or one cancelled after signing because its
// disbursement failed. Never NULL (status is NOT NULL, IS NOT DISTINCT FROM never gives NULL), so
// it can be compared with `=`.
const SIGNED = `(status IN ('signed', ${LIVE}) OR cancellation_reason IS NOT DISTINCT FROM 'disbursement_failed')`;

const SIGNATURE_BY_STATUS = `
  (status <> 'draft' OR envelope_id IS NULL)
  AND (status <> 'sent_for_signature' OR envelope_id IS NOT NULL)
  AND (NOT ${SIGNED} OR envelope_id IS NOT NULL)
  AND (${SIGNED} = (signed_at IS NOT NULL))
  AND ((status IN (${LIVE})) = (activated_on IS NOT NULL))
  AND ((status = 'cancelled') = (cancellation_reason IS NOT NULL))
`;

// As 202610121949-allow-lending-contracts-in-arrears left it.
const PREVIOUS_SIGNATURE_BY_STATUS = `
  (status <> 'draft' OR envelope_id IS NULL)
  AND (status NOT IN ('sent_for_signature', 'signed', ${LIVE}) OR envelope_id IS NOT NULL)
  AND ((status IN ('signed', ${LIVE})) = (signed_at IS NOT NULL))
  AND ((status IN (${LIVE})) = (activated_on IS NOT NULL))
  AND ((status = 'cancelled') = (cancellation_reason IS NOT NULL))
`;

// A cancelled disbursement keeps the reason it failed.
const DISBURSEMENT_STATE = `
  (status NOT IN ('sent', 'settled')
   OR (transfer_id IS NOT NULL AND creditor_iban_encrypted IS NOT NULL))
  AND ((status = 'settled') = (settled_at IS NOT NULL))
  AND ((status IN ('failed', 'cancelled')) = (failure_reason IS NOT NULL))
`;

// As 202610121817-create-lending-disbursements left it.
const PREVIOUS_DISBURSEMENT_STATE = `
  (status NOT IN ('sent', 'settled')
   OR (transfer_id IS NOT NULL AND creditor_iban_encrypted IS NOT NULL))
  AND ((status = 'settled') = (settled_at IS NOT NULL))
  AND ((status = 'failed') = (failure_reason IS NOT NULL))
`;

// A signed contract whose disbursement failed for good is cancelled by ops (`disbursement_failed`)
// with its disbursement (`cancelled`, never retried, keeping why it failed). The contract keeps
// its signature: it was signed, and never took effect.
export class AllowCancellingUndisbursedContracts1791883380000 implements MigrationInterface {
  name = 'AllowCancellingUndisbursedContracts1791883380000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replaceContractChecks(
      queryRunner,
      `'signature_declined', 'signature_expired', 'disbursement_failed'`,
      SIGNATURE_BY_STATUS,
    );
    await this.replaceDisbursementChecks(
      queryRunner,
      `'pending', 'sent', 'settled', 'failed', 'cancelled'`,
      DISBURSEMENT_STATE,
    );
  }

  // Before this, such a contract stayed signed with its disbursement failed: those cancelled go
  // back to that (their application, withdrawn by origination, stays withdrawn).
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE lending.disbursements SET status = 'failed' WHERE status = 'cancelled'`,
    );
    await queryRunner.query(`
      UPDATE lending.contracts SET status = 'signed', cancellation_reason = NULL
        WHERE cancellation_reason = 'disbursement_failed'
    `);
    await this.replaceDisbursementChecks(
      queryRunner,
      `'pending', 'sent', 'settled', 'failed'`,
      PREVIOUS_DISBURSEMENT_STATE,
    );
    await this.replaceContractChecks(
      queryRunner,
      `'signature_declined', 'signature_expired'`,
      PREVIOUS_SIGNATURE_BY_STATUS,
    );
  }

  private async replaceContractChecks(
    queryRunner: QueryRunner,
    reasons: string,
    signatureByStatus: string,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lending.contracts
        DROP CONSTRAINT ck_lending_contracts_signature_by_status,
        DROP CONSTRAINT ck_lending_contracts_cancellation_reason
    `);
    await queryRunner.query(`
      ALTER TABLE lending.contracts
        ADD CONSTRAINT ck_lending_contracts_cancellation_reason
          CHECK (cancellation_reason IN (${reasons})),
        ADD CONSTRAINT ck_lending_contracts_signature_by_status
          CHECK (${signatureByStatus})
    `);
  }

  private async replaceDisbursementChecks(
    queryRunner: QueryRunner,
    statuses: string,
    state: string,
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lending.disbursements
        DROP CONSTRAINT ck_lending_disbursements_state,
        DROP CONSTRAINT ck_lending_disbursements_status
    `);
    await queryRunner.query(`
      ALTER TABLE lending.disbursements
        ADD CONSTRAINT ck_lending_disbursements_status CHECK (status IN (${statuses})),
        ADD CONSTRAINT ck_lending_disbursements_state CHECK (${state})
    `);
  }
}
