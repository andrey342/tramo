import { type MigrationInterface, type QueryRunner } from 'typeorm';

const TYPES = ['charge', 'payment', 'write_off', 'cancellation'];

// A direct debit the debtor's bank sends back after it was collected gets a line of its own on
// the statement (`return`), owed again like a charge: positive.
export class AllowBillingLedgerReturns1791883080000 implements MigrationInterface {
  name = 'AllowBillingLedgerReturns1791883080000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...TYPES, 'return'], ['charge', 'return']);
  }

  // Before this, a return had no line: those projected are removed (the charge events stay in the
  // outbox).
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM billing.ledger_entries WHERE type = 'return'`);
    await this.replace(queryRunner, TYPES, ['charge']);
  }

  private async replace(
    queryRunner: QueryRunner,
    types: readonly string[],
    owed: readonly string[],
  ): Promise<void> {
    const list = (values: readonly string[]): string =>
      values.map((value) => `'${value}'`).join(', ');
    await queryRunner.query(`
      ALTER TABLE billing.ledger_entries
        DROP CONSTRAINT ck_billing_ledger_entries_amount_cents,
        DROP CONSTRAINT ck_billing_ledger_entries_type,
        ADD CONSTRAINT ck_billing_ledger_entries_type CHECK (type IN (${list(types)})),
        ADD CONSTRAINT ck_billing_ledger_entries_amount_cents
          CHECK ((type IN (${list(owed)})) = (amount_cents > 0) AND amount_cents <> 0)
    `);
  }
}
