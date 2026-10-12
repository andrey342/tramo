import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateLendingFinancingPlans1791829080000 implements MigrationInterface {
  name = 'CreateLendingFinancingPlans1791829080000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lending.financing_plans (
        id uuid NOT NULL,
        contract_id uuid NOT NULL,
        -- iam's student and catalog's center (ADR 008).
        student_id uuid NOT NULL,
        center_id uuid NOT NULL,
        kind text NOT NULL CONSTRAINT ck_lending_financing_plans_kind
          CHECK (kind IN ('installments', 'isa')),
        principal_cents integer NOT NULL
          CONSTRAINT ck_lending_financing_plans_principal_cents CHECK (principal_cents > 0),
        starts_on date NOT NULL,
        -- The instalment table, or the terms and running totals of an ISA: read back whole.
        terms jsonb NOT NULL CONSTRAINT ck_lending_financing_plans_terms
          CHECK (jsonb_typeof(terms) = 'object' AND terms ->> 'kind' = kind),
        status text NOT NULL CONSTRAINT ck_lending_financing_plans_status
          CHECK (status IN ('active', 'completed')),
        completion_reason text NULL CONSTRAINT ck_lending_financing_plans_completion_reason
          CHECK (completion_reason IN ('repaid', 'paid_off', 'cap_reached', 'max_payments',
                                       'window_expired')),
        completed_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_lending_financing_plans_version CHECK (version > 0),
        CONSTRAINT pk_lending_financing_plans PRIMARY KEY (id),
        CONSTRAINT fk_lending_financing_plans_contract_id FOREIGN KEY (contract_id)
          REFERENCES lending.contracts (id),
        CONSTRAINT ck_lending_financing_plans_completion CHECK (
          (status = 'completed') = (completion_reason IS NOT NULL)
          AND (status = 'completed') = (completed_at IS NOT NULL)
        )
      )
    `);
    // One plan per contract; also the index of the foreign key.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_lending_financing_plans_contract_id
        ON lending.financing_plans (contract_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE lending.financing_plans`);
  }
}
