import { Injectable } from '@nestjs/common';

import { Iban, Money, Percentage, unwrap, VatNumber } from '@shared/domain';
import { FieldCipher } from '@shared/infrastructure/crypto';

import { FinancingOptions, Program, TrainingCenter } from '../../domain';

import { type ProgramOrmEntity } from './program.orm-entity';
import { type TrainingCenterOrmEntity } from './training-center.orm-entity';

// Binds the ciphertext to its row: copied into another center, it no longer decrypts (ADR 014).
const payoutIbanContext = (centerId: string): string =>
  `catalog.training_centers.payout_iban:${centerId}`;

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
      payoutIban: unwrap(
        Iban.create(this.cipher.decrypt(row.payoutIbanEncrypted, payoutIbanContext(row.id))),
      ),
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
      payoutIbanEncrypted: this.cipher.encrypt(
        center.payoutIban.value,
        payoutIbanContext(center.id),
      ),
      payoutIbanLast4: center.payoutIban.lastFour,
      platformFeeBps: center.platformFee.basisPoints,
      createdAt: center.createdAt,
    };
  }
}

export const ProgramMapper = {
  toDomain(row: ProgramOrmEntity): Program {
    const program = Program.reconstitute(row.id, {
      centerId: row.centerId,
      name: row.name,
      modality: row.modality,
      price: Money.fromCents(row.priceCents),
      durationWeeks: row.durationWeeks,
      startDates: row.startDates,
      employabilityRate: Percentage.fromBasisPoints(row.employabilityBps),
      avgStartingSalary: Money.fromCents(row.avgStartingSalaryCents),
      financing: FinancingOptions.of({
        installments:
          row.installmentTerms && row.installmentRateBps !== null
            ? {
                allowedTerms: row.installmentTerms,
                annualRate: Percentage.fromBasisPoints(row.installmentRateBps),
              }
            : null,
        isa:
          row.isaIncomeShareBps !== null &&
          row.isaMinMonthlyIncomeCents !== null &&
          row.isaMaxPayments !== null &&
          row.isaCapMultiplierHundredths !== null &&
          row.isaGraceMonths !== null
            ? {
                incomeShare: Percentage.fromBasisPoints(row.isaIncomeShareBps),
                minMonthlyIncome: Money.fromCents(row.isaMinMonthlyIncomeCents),
                maxPayments: row.isaMaxPayments,
                capMultiplierHundredths: row.isaCapMultiplierHundredths,
                graceMonths: row.isaGraceMonths,
              }
            : null,
      }),
      status: row.status,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
    });
    program.markPersisted(row.version);
    return program;
  },

  toRow(program: Program): Omit<ProgramOrmEntity, 'version'> {
    const details = program.details;
    const { installments, isa } = program.financing;
    return {
      id: program.id,
      centerId: program.centerId,
      name: details.name,
      modality: details.modality,
      priceCents: details.price.cents,
      durationWeeks: details.durationWeeks,
      startDates: [...details.startDates],
      employabilityBps: details.employabilityRate.basisPoints,
      avgStartingSalaryCents: details.avgStartingSalary.cents,
      installmentTerms: installments ? [...installments.allowedTerms] : null,
      installmentRateBps: installments?.annualRate.basisPoints ?? null,
      isaIncomeShareBps: isa?.incomeShare.basisPoints ?? null,
      isaMinMonthlyIncomeCents: isa?.minMonthlyIncome.cents ?? null,
      isaMaxPayments: isa?.maxPayments ?? null,
      isaCapMultiplierHundredths: isa?.capMultiplierHundredths ?? null,
      isaGraceMonths: isa?.graceMonths ?? null,
      status: program.status,
      publishedAt: program.publishedAt,
      createdAt: program.createdAt,
    };
  },
};
