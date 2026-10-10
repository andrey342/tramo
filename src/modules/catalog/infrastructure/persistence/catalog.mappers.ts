import { Injectable } from '@nestjs/common';

import { Iban, Percentage, unwrap, VatNumber } from '@shared/domain';
import { FieldCipher } from '@shared/infrastructure/crypto';

import { TrainingCenter } from '../../domain';

import { type TrainingCenterOrmEntity } from './training-center.orm-entity';

// A class rather than a plain object like iam's mappers: it needs the cipher for the IBAN.
@Injectable()
export class TrainingCenterMapper {
  constructor(private readonly cipher: FieldCipher) {}

  toDomain(row: TrainingCenterOrmEntity): TrainingCenter {
    const center = TrainingCenter.reconstitute(row.id, {
      name: row.name,
      vatNumber: unwrap(VatNumber.create(row.country, row.taxNumber)),
      status: row.status,
      vatValidation:
        row.vatStatus && row.vatCheckedAt && row.vatProvider
          ? {
              status: row.vatStatus,
              checkedAt: row.vatCheckedAt,
              provider: row.vatProvider,
              registeredName: row.vatRegisteredName,
            }
          : null,
      payoutIban: unwrap(Iban.create(this.cipher.decrypt(row.payoutIbanEncrypted))),
      platformFee: Percentage.fromBasisPoints(row.platformFeeBps),
      createdAt: row.createdAt,
    });
    center.markPersisted(row.version);
    return center;
  }

  // Re-encrypts the IBAN on every save: a fresh IV each time, and a rotated key takes over as
  // centers are saved.
  toRow(center: TrainingCenter): Omit<TrainingCenterOrmEntity, 'version'> {
    const vat = center.vatValidation;
    return {
      id: center.id,
      name: center.name,
      country: center.vatNumber.country,
      taxNumber: center.vatNumber.number,
      status: center.status,
      vatStatus: vat?.status ?? null,
      vatCheckedAt: vat?.checkedAt ?? null,
      vatProvider: vat?.provider ?? null,
      vatRegisteredName: vat?.registeredName ?? null,
      payoutIbanEncrypted: this.cipher.encrypt(center.payoutIban.value),
      payoutIbanLast4: center.payoutIban.lastFour,
      platformFeeBps: center.platformFee.basisPoints,
      createdAt: center.createdAt,
    };
  }
}
