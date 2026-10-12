import { Injectable } from '@nestjs/common';

import { CalendarDate, Iban, Money, unwrap } from '@shared/domain';
import { FieldCipher } from '@shared/infrastructure/crypto';

import { Charge, IncomeDeclaration, PaymentMandate } from '../../domain';

import {
  type ChargeOrmEntity,
  type IncomeDeclarationOrmEntity,
  type PaymentMandateOrmEntity,
} from './billing.orm-entities';

// Binds the ciphertext to its row: copied into another mandate, it no longer decrypts (ADR 014).
const ibanContext = (mandateId: string): string => `billing.payment_mandates.iban:${mandateId}`;

// A class: it needs the cipher for the IBAN.
@Injectable()
export class PaymentMandateMapper {
  constructor(private readonly cipher: FieldCipher) {}

  toDomain(row: PaymentMandateOrmEntity): PaymentMandate {
    const mandate = PaymentMandate.reconstitute(row.id, {
      contractId: row.contractId,
      studentId: row.studentId,
      iban: unwrap(Iban.create(this.cipher.decrypt(row.ibanEncrypted, ibanContext(row.id)))),
      reference: row.reference,
      status: row.status,
      signedAt: row.signedAt,
      revokedAt: row.revokedAt,
    });
    mandate.markPersisted(row.version);
    return mandate;
  }

  toRow(mandate: PaymentMandate): Omit<PaymentMandateOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: mandate.id,
      contractId: mandate.contractId,
      studentId: mandate.studentId,
      ibanEncrypted: this.cipher.encrypt(mandate.iban.value, ibanContext(mandate.id)),
      reference: mandate.reference,
      status: mandate.status,
      signedAt: mandate.signedAt,
      revokedAt: mandate.revokedAt,
    };
  }
}

export const ChargeMapper = {
  toDomain(row: ChargeOrmEntity): Charge {
    const charge = Charge.reconstitute(row.id, {
      contractId: row.contractId,
      studentId: row.studentId,
      centerId: row.centerId,
      kind: row.kind,
      reference: row.reference,
      installmentNumber: row.installmentNumber,
      period: row.period,
      amount: Money.fromCents(row.amountCents),
      dueDate: CalendarDate.parse(row.dueDate),
      status: row.status,
      attempts: row.attempts.map((attempt) => ({
        ...attempt,
        submittedAt: new Date(attempt.submittedAt),
        settledAt: attempt.settledAt === null ? null : new Date(attempt.settledAt),
      })),
      dunningStep: row.dunningStep,
      paidAt: row.paidAt,
      statusChangedAt: row.statusChangedAt,
      createdAt: row.createdAt,
    });
    charge.markPersisted(row.version);
    return charge;
  },

  toRow(charge: Charge): Omit<ChargeOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: charge.id,
      contractId: charge.contractId,
      studentId: charge.studentId,
      centerId: charge.centerId,
      kind: charge.kind,
      reference: charge.reference,
      installmentNumber: charge.installmentNumber,
      period: charge.period,
      amountCents: charge.amount.cents,
      dueDate: charge.dueDate.toString(),
      status: charge.status,
      attempts: charge.attempts.map((attempt) => ({
        ...attempt,
        submittedAt: attempt.submittedAt.toISOString(),
        settledAt: attempt.settledAt?.toISOString() ?? null,
      })),
      dunningStep: charge.dunningStep,
      paidAt: charge.paidAt,
      statusChangedAt: charge.statusChangedAt,
      createdAt: charge.createdAt,
    };
  },
};

export const IncomeDeclarationMapper = {
  toDomain(row: IncomeDeclarationOrmEntity): IncomeDeclaration {
    const declaration = IncomeDeclaration.reconstitute(row.id, {
      contractId: row.contractId,
      studentId: row.studentId,
      period: row.period,
      grossMonthlyIncome: Money.fromCents(row.grossMonthlyIncomeCents),
      source: row.source,
      declaredAt: row.declaredAt,
    });
    declaration.markPersisted(row.version);
    return declaration;
  },

  toRow(declaration: IncomeDeclaration): Omit<IncomeDeclarationOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: declaration.id,
      contractId: declaration.contractId,
      studentId: declaration.studentId,
      period: declaration.period,
      grossMonthlyIncomeCents: declaration.grossMonthlyIncome.cents,
      source: declaration.source,
      declaredAt: declaration.declaredAt,
    };
  },
};
