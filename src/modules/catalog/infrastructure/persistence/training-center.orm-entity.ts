import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { type VatCountry } from '@shared/domain';

import { type CenterStatus, type VatValidationStatus } from '../../domain';

@Entity({ schema: 'catalog', name: 'training_centers' })
export class TrainingCenterOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text')
  name: string;

  @Column('text')
  country: VatCountry;

  @Column('text', { name: 'tax_number' })
  taxNumber: string;

  @Column('text')
  status: CenterStatus;

  @Column('text', { name: 'vat_status', nullable: true })
  vatStatus: VatValidationStatus | null;

  @Column({ type: 'timestamptz', name: 'vat_checked_at', precision: 3, nullable: true })
  vatCheckedAt: Date | null;

  @Column('text', { name: 'vat_provider', nullable: true })
  vatProvider: string | null;

  @Column('text', { name: 'vat_registered_name', nullable: true })
  vatRegisteredName: string | null;

  // AES-256-GCM ciphertext (ADR 014); the last four characters are kept apart for listings.
  @Column('text', { name: 'payout_iban_encrypted' })
  payoutIbanEncrypted: string;

  @Column('text', { name: 'payout_iban_last4' })
  payoutIbanLast4: string;

  @Column('integer', { name: 'platform_fee_bps' })
  platformFeeBps: number;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}
