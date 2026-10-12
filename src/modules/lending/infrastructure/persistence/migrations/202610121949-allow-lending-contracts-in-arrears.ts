import { type MigrationInterface, type QueryRunner } from 'typeorm';

const SIGNATURE_BY_STATUS = (live: string): string => `
  (status <> 'draft' OR envelope_id IS NULL)
  AND (status NOT IN ('sent_for_signature', 'signed', ${live}) OR envelope_id IS NOT NULL)
  AND ((status IN ('signed', ${live})) = (signed_at IS NOT NULL))
  AND ((status IN (${live})) = (activated_on IS NOT NULL))
  AND ((status = 'cancelled') = (cancellation_reason IS NOT NULL))
`;

// A contract with a charge 30 days overdue is in arrears (billing's dunning) until it is paid:
// a status of its own, signed and activated like an active one.
export class AllowLendingContractsInArrears1791834540000 implements MigrationInterface {
  name = 'AllowLendingContractsInArrears1791834540000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(
      queryRunner,
      `'draft', 'sent_for_signature', 'signed', 'active', 'in_arrears', 'completed', 'defaulted', 'cancelled'`,
      `'active', 'in_arrears', 'completed', 'defaulted'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.replace(
      queryRunner,
      `'draft', 'sent_for_signature', 'signed', 'active', 'completed', 'defaulted', 'cancelled'`,
      `'active', 'completed', 'defaulted'`,
    );
  }

  private async replace(queryRunner: QueryRunner, statuses: string, live: string): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lending.contracts
        DROP CONSTRAINT ck_lending_contracts_signature_by_status,
        DROP CONSTRAINT ck_lending_contracts_status
    `);
    await queryRunner.query(`
      ALTER TABLE lending.contracts
        ADD CONSTRAINT ck_lending_contracts_status CHECK (status IN (${statuses})),
        ADD CONSTRAINT ck_lending_contracts_signature_by_status CHECK (${SIGNATURE_BY_STATUS(live)})
    `);
  }
}
