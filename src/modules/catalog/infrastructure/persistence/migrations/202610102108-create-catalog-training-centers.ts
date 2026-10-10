import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateCatalogTrainingCenters1791666480000 implements MigrationInterface {
  name = 'CreateCatalogTrainingCenters1791666480000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE catalog.training_centers (
        id uuid NOT NULL,
        name text NOT NULL CONSTRAINT ck_catalog_training_centers_name
          CHECK (length(name) BETWEEN 1 AND 200),
        country text NOT NULL CONSTRAINT ck_catalog_training_centers_country
          CHECK (country IN ('ES', 'DE')),
        tax_number text NOT NULL CONSTRAINT ck_catalog_training_centers_tax_number
          CHECK (tax_number ~ '^[A-Z0-9]{2,12}$'),
        status text NOT NULL CONSTRAINT ck_catalog_training_centers_status
          CHECK (status IN ('pending_verification', 'active', 'suspended')),
        -- The latest VAT check; all four columns are set together or not at all.
        vat_status text NULL CONSTRAINT ck_catalog_training_centers_vat_status
          CHECK (vat_status IN ('valid', 'invalid', 'unverified')),
        vat_checked_at timestamptz(3) NULL,
        vat_provider text NULL,
        vat_registered_name text NULL,
        -- AES-256-GCM ciphertext (ADR 014); last four characters kept apart for listings.
        payout_iban_encrypted text NOT NULL,
        payout_iban_last4 text NOT NULL CONSTRAINT ck_catalog_training_centers_payout_iban_last4
          CHECK (payout_iban_last4 ~ '^[A-Z0-9]{4}$'),
        platform_fee_bps integer NOT NULL CONSTRAINT ck_catalog_training_centers_platform_fee_bps
          CHECK (platform_fee_bps BETWEEN 0 AND 3000),
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_catalog_training_centers_version CHECK (version > 0),
        CONSTRAINT pk_catalog_training_centers PRIMARY KEY (id),
        CONSTRAINT ck_catalog_training_centers_vat_check CHECK (
          (vat_status IS NULL) = (vat_checked_at IS NULL)
          AND (vat_status IS NULL) = (vat_provider IS NULL)
        ),
        -- Only an active center has a valid VAT number; nothing else may be active.
        CONSTRAINT ck_catalog_training_centers_active_is_valid CHECK (
          status <> 'active' OR vat_status = 'valid'
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX ux_catalog_training_centers_country_tax_number
         ON catalog.training_centers (country, tax_number)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE catalog.training_centers`);
  }
}
