import { type MigrationInterface, type QueryRunner } from 'typeorm';

// Instalment plans record which instalments were paid (billing may collect a retried one after
// the next) instead of how many: `installmentsPaid: n` becomes `paidInstallments: [1..n]`.
export class TrackLendingPaidInstallments1791834600000 implements MigrationInterface {
  name = 'TrackLendingPaidInstallments1791834600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE lending.financing_plans
         SET terms = (terms - 'installmentsPaid') || jsonb_build_object(
               'paidInstallments',
               COALESCE(
                 (SELECT jsonb_agg(n ORDER BY n)
                    FROM generate_series(1, (terms ->> 'installmentsPaid')::integer) AS n),
                 '[]'::jsonb
               )
             )
       WHERE kind = 'installments' AND terms ? 'installmentsPaid'
    `);
  }

  // Exact for plans paid in order, the only kind there was before this migration; refuses to
  // turn a set with gaps into a count that would say otherwise.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM lending.financing_plans
           WHERE kind = 'installments'
             AND terms -> 'paidInstallments' <> COALESCE(
               (SELECT jsonb_agg(n ORDER BY n)
                  FROM generate_series(1, jsonb_array_length(terms -> 'paidInstallments')) AS n),
               '[]'::jsonb)
        ) THEN
          RAISE EXCEPTION 'A plan has instalments paid out of order; it cannot be counted.';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      UPDATE lending.financing_plans
         SET terms = (terms - 'paidInstallments') || jsonb_build_object(
               'installmentsPaid', jsonb_array_length(terms -> 'paidInstallments')
             )
       WHERE kind = 'installments' AND terms ? 'paidInstallments'
    `);
  }
}
