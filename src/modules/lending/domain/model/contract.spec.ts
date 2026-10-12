import { uuidv7 } from 'uuidv7';

import { InvalidStateTransitionError, Money, Percentage } from '@shared/domain';

import {
  aContract,
  aContractSentForSignature,
  anActiveContract,
  anIsa,
  aSignedContract,
  DOCUMENT_HASH,
  LATER,
  NOW,
  someTerms,
} from '../../../../../test/factories/lending';
import { InvalidContractTermsError, SignatureMismatchError } from '../errors/lending-errors';
import { LendingEvents } from '../events/lending-events';
import { renderContractDocument } from '../services/contract-document';

import { Contract } from './contract';
import { disbursementAmount, platformFeeAmount } from './contract-terms';

const eventTypes = (contract: Contract): string[] =>
  contract.pullEvents().map((event) => event.eventType);

describe('Contract', () => {
  describe('draw', () => {
    it('should start as a draft and announce it with its principal', () => {
      const contract = aContract();

      expect(contract.status).toBe('draft');
      expect(contract.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: LendingEvents.ContractCreated,
          payload: expect.objectContaining({
            contractId: contract.id,
            product: 'installments',
            principalCents: 7_500_00,
          }),
        }),
      ]);
    });

    it.each([
      ['a principal of zero', someTerms({ principal: Money.zero() })],
      [
        'a term that is not a whole number of months',
        someTerms({
          product: { kind: 'installments', termMonths: 0, annualRate: Percentage.zero() },
        }),
      ],
      ['an ISA without a share', someTerms({ product: anIsa({ incomeShare: Percentage.zero() }) })],
      [
        'an ISA capped below the principal',
        someTerms({ product: anIsa({ capMultiplierHundredths: 90 }) }),
      ],
      ['an ISA without payments', someTerms({ product: anIsa({ maxPayments: 0 }) })],
      ['a negative grace period', someTerms({ product: anIsa({ graceMonths: -1 }) })],
    ])('should refuse %s', (_case, terms) => {
      expect(() =>
        Contract.draw({
          id: uuidv7(),
          applicationId: uuidv7(),
          studentId: uuidv7(),
          centerId: uuidv7(),
          program: { programId: uuidv7(), name: 'Bootcamp', durationWeeks: 12 },
          terms,
          now: NOW,
        }),
      ).toThrow(InvalidContractTermsError);
    });

    // 5 % of 7,500 is 375: the center receives 7,125.
    it('should pay the center the principal less the platform fee', () => {
      const terms = aContract().terms;

      expect(platformFeeAmount(terms)).toEqual(Money.fromCents(375_00));
      expect(disbursementAmount(terms)).toEqual(Money.fromCents(7_125_00));
    });
  });

  describe('signature', () => {
    it('should be sent for signature from a draft, with the envelope and the document hash', () => {
      const contract = aContract();
      contract.pullEvents();

      contract.sentForSignature(
        { provider: 'simulated', envelopeId: 'env_1', documentHash: DOCUMENT_HASH },
        LATER,
      );

      expect(contract.status).toBe('sent_for_signature');
      expect(contract.signature).toEqual({
        provider: 'simulated',
        envelopeId: 'env_1',
        documentHash: DOCUMENT_HASH,
        sentAt: LATER,
        signedAt: null,
      });
      expect(eventTypes(contract)).toEqual([LendingEvents.ContractSentForSignature]);
      expect(() => {
        contract.sentForSignature(
          { provider: 'simulated', envelopeId: 'env_2', documentHash: DOCUMENT_HASH },
          LATER,
        );
      }).toThrow(InvalidStateTransitionError);
    });

    it('should be signed by the callback of its envelope over its document, once', () => {
      const contract = aContractSentForSignature();
      const callback = {
        envelopeId: `env_${contract.id}`,
        documentHash: DOCUMENT_HASH,
        signedAt: NOW,
      };

      contract.sign(callback, LATER);
      contract.sign(callback, LATER);

      expect(contract.status).toBe('signed');
      expect(contract.signature?.signedAt).toEqual(NOW);
      expect(contract.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: LendingEvents.ContractSigned,
          payload: expect.objectContaining({
            contractId: contract.id,
            disbursementAmountCents: 7_125_00,
            signedAt: NOW.toISOString(),
          }),
        }),
      ]);
    });

    it('should refuse a signature for another envelope or another document', () => {
      const contract = aContractSentForSignature();

      expect(() => {
        contract.sign({ envelopeId: 'env_other', documentHash: DOCUMENT_HASH, signedAt: NOW }, NOW);
      }).toThrow(SignatureMismatchError);
      expect(() => {
        contract.sign(
          { envelopeId: `env_${contract.id}`, documentHash: 'b'.repeat(64), signedAt: NOW },
          NOW,
        );
      }).toThrow(SignatureMismatchError);
      expect(contract.status).toBe('sent_for_signature');
    });

    it('should not be signed before it is sent', () => {
      expect(() => {
        aContract().sign({ envelopeId: 'env', documentHash: DOCUMENT_HASH, signedAt: NOW }, NOW);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('cancel', () => {
    it('should be cancelled when the student declines, once', () => {
      const contract = aContractSentForSignature();

      contract.cancel('signature_declined', LATER);
      contract.cancel('signature_declined', LATER);

      expect(contract.status).toBe('cancelled');
      expect(contract.cancellationReason).toBe('signature_declined');
      expect(eventTypes(contract)).toEqual([LendingEvents.ContractCancelled]);
    });

    it('should not be cancelled once signed', () => {
      expect(() => {
        aSignedContract().cancel('signature_expired', LATER);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('activation and completion', () => {
    it('should be activated once signed, on the day the center was paid (UTC)', () => {
      const contract = aSignedContract();

      contract.activate(new Date('2026-10-14T23:30:00Z'));

      expect(contract.status).toBe('active');
      expect(contract.activatedOn?.toString()).toBe('2026-10-14');
      expect(contract.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: LendingEvents.ContractActivated,
          payload: expect.objectContaining({ activatedOn: '2026-10-14', product: 'installments' }),
        }),
      ]);
    });

    it('should not be activated before it is signed', () => {
      expect(() => {
        aContractSentForSignature().activate(NOW);
      }).toThrow(InvalidStateTransitionError);
    });

    it('should be completed when active', () => {
      const contract = anActiveContract();

      contract.complete(LATER);

      expect(contract.status).toBe('completed');
      expect(eventTypes(contract)).toEqual([LendingEvents.ContractCompleted]);
      expect(() => {
        aSignedContract().complete(LATER);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('document', () => {
    it('should state the instalment terms, the same text every time', () => {
      const contract = aContract();

      const document = renderContractDocument(contract);

      expect(document).toBe(renderContractDocument(contract));
      expect(document).toContain(`Contract: ${contract.id}`);
      expect(document).toContain('Amount financed: 7500.00 EUR');
      expect(document).toContain('Nominal annual rate (TIN): 7.50 %');
      expect(document).toContain('Annual percentage rate (TAE): 7.76 %');
      expect(document).toContain('Monthly instalment: 337.50 EUR');
    });

    it('should state the ISA share, threshold, cap and window', () => {
      const document = renderContractDocument(aContract({ terms: { product: anIsa() } }));

      expect(document).toContain('Income share: 10.00 % of gross monthly income');
      expect(document).toContain('income below 1500.00 EUR');
      expect(document).toContain('at most 36 payments and never more than 11250.00 EUR');
      expect(document).toContain('8 years after the end of the program');
    });
  });
});
