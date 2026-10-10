import { InvalidStateTransitionError, InvalidValueError, Money } from '@shared/domain';

import {
  aCompleteProfile,
  aDraftApplication,
  anApplicationInScoring,
  aProgramSnapshot,
  aSubmittedApplication,
  cleanBureau,
  LATER,
  NOW,
  passedKyc,
  steadyEmployment,
} from '../../../../../test/factories/origination';
import { ApplicationIncompleteError, ProductNotOfferedError } from '../errors/origination-errors';
import { OriginationEvents } from '../events/origination-events';
import { RiskPolicy } from '../model/risk-policy';
import { ScoringEngine } from '../services/scoring-engine';

import { EMPTY_PROFILE } from './applicant-profile';
import { type DecisionRecord } from './decision-record';
import { EXPIRY_DAYS, type FinancingApplication } from './financing-application';

const DAY_MS = 24 * 60 * 60 * 1000;
const eventTypes = (application: FinancingApplication): string[] =>
  application.pullEvents().map((event) => event.eventType);

const decisionOf = (application: FinancingApplication, outcome: DecisionRecord['outcome']) => ({
  ...ScoringEngine.decide(
    {
      profile: application.submittedProfile,
      program: application.program,
      product: application.product,
      kyc: passedKyc(),
      employment: steadyEmployment(),
      bureau: cleanBureau(),
    },
    RiskPolicy.initial(NOW),
    LATER,
  ),
  outcome,
});

describe('FinancingApplication', () => {
  describe('drafts', () => {
    it('should start as a draft for a product the program offers, without announcing it', () => {
      const application = aDraftApplication({ profile: EMPTY_PROFILE });

      expect(application.status).toBe('draft');
      expect(application.pullEvents()).toEqual([]);
    });

    it.each([
      ['a term the program does not offer', { kind: 'installments', termMonths: 18 } as const],
      ['an ISA the program does not offer', { kind: 'isa' } as const],
    ])('should refuse %s', (_case, product) => {
      expect(() =>
        aDraftApplication({ program: aProgramSnapshot({ isa: null }), product }),
      ).toThrow(ProductNotOfferedError);
    });

    it('should complete the profile little by little and check what is given', () => {
      const application = aDraftApplication({ profile: EMPTY_PROFILE });

      application.updateDraft({ profile: { residenceCountry: 'ES' } }, LATER);
      application.updateDraft({ product: { kind: 'isa' } }, LATER);

      expect(application.profile.residenceCountry).toBe('ES');
      expect(application.product).toEqual({ kind: 'isa' });
      expect(() => {
        application.updateDraft({ profile: { dateOfBirth: '2030-01-01' } }, LATER);
      }).toThrow(InvalidValueError);
      expect(() => {
        application.updateDraft({ profile: { dateOfBirth: '2001-02-29' } }, LATER);
      }).toThrow(InvalidValueError);
      expect(() => {
        application.updateDraft({ profile: { residenceCountry: 'Spain' } }, LATER);
      }).toThrow(InvalidValueError);
      expect(() => {
        application.updateDraft({ profile: { declaredMonthlyIncome: Money.fromCents(-1) } }, LATER);
      }).toThrow(InvalidValueError);
    });

    it('should submit a complete draft with the current program and announce it', () => {
      const application = aDraftApplication();
      const current = { ...application.program, price: Money.fromCents(6_900_00) };

      application.submit(current, LATER);

      expect(application.status).toBe('submitted');
      expect(application.program.price.cents).toBe(690_000);
      expect(application.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: OriginationEvents.ApplicationSubmitted,
          payload: expect.objectContaining({
            amountCents: 690_000,
            product: 'installments',
          }) as object,
        }),
      ]);
    });

    it('should name what is missing, and refuse a product the program stopped offering', () => {
      const incomplete = aDraftApplication({
        profile: { ...aCompleteProfile(), nationalId: null, employmentStatus: null },
      });
      const application = aDraftApplication();

      expect(() => {
        incomplete.submit(incomplete.program, LATER);
      }).toThrow(new ApplicationIncompleteError(['nationalId', 'employmentStatus']));
      expect(() => {
        application.submit({ ...application.program, installments: null }, LATER);
      }).toThrow(ProductNotOfferedError);
    });

    it('should only change while it is a draft', () => {
      const application = aSubmittedApplication();

      expect(() => {
        application.updateDraft({ profile: { residenceCountry: 'PT' } }, LATER);
      }).toThrow(InvalidStateTransitionError);
      expect(() => {
        application.submit(application.program, LATER);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('verification', () => {
    it('should move to scoring once all three providers have answered, in any order', () => {
      const application = aSubmittedApplication();

      application.startVerification(LATER);
      application.recordVerification({ type: 'bureau', result: cleanBureau() }, LATER);
      application.recordVerification({ type: 'kyc', result: passedKyc() }, LATER);
      expect(application.status).toBe('verifying');
      application.recordVerification({ type: 'employment', result: steadyEmployment() }, LATER);

      expect(application.status).toBe('scoring');
      expect(application.verifications.kyc?.checkedAt).toEqual(LATER);
      expect(eventTypes(application)).toEqual([
        OriginationEvents.VerificationCompleted,
        OriginationEvents.VerificationCompleted,
        OriginationEvents.VerificationCompleted,
      ]);
    });

    it('should keep the first answer of a provider and accept answers before the saga marks it', () => {
      const application = aSubmittedApplication();

      application.recordVerification(
        { type: 'bureau', result: cleanBureau({ score: 500 }) },
        LATER,
      );
      application.recordVerification(
        { type: 'bureau', result: cleanBureau({ score: 900 }) },
        LATER,
      );

      expect(application.status).toBe('verifying');
      expect(application.verifications.bureau?.score).toBe(500);
      expect(eventTypes(application)).toEqual([OriginationEvents.VerificationCompleted]);
      expect(() => {
        application.startVerification(LATER);
      }).toThrow(InvalidStateTransitionError);
    });

    it('should refuse answers once verification is over', () => {
      const application = anApplicationInScoring();

      expect(() => {
        application.recordVerification({ type: 'kyc', result: passedKyc() }, LATER);
      }).toThrow(InvalidStateTransitionError);
      expect(application.awaitsVerification).toBe(false);
    });
  });

  describe('decisions', () => {
    it.each([
      ['approved', OriginationEvents.ApplicationApproved],
      ['needs_review', OriginationEvents.ApplicationNeedsReview],
      ['rejected', OriginationEvents.ApplicationRejected],
    ] as const)('should record a decision that %s it', (outcome, eventType) => {
      const application = anApplicationInScoring();

      application.decide(decisionOf(application, outcome), LATER);

      expect(application.status).toBe(outcome);
      expect(application.decision?.outcome).toBe(outcome);
      expect(eventTypes(application)).toEqual([eventType]);
    });

    it('should only take the engine decision while scoring', () => {
      const application = aSubmittedApplication();

      expect(() => {
        application.decide(decisionOf(anApplicationInScoring(), 'approved'), LATER);
      }).toThrow(InvalidStateTransitionError);
    });

    it('should let ops settle a review with a reason', () => {
      const approved = anApplicationInScoring();
      approved.decide(decisionOf(approved, 'needs_review'), LATER);
      approved.pullEvents();
      const rejected = anApplicationInScoring();
      rejected.decide(decisionOf(rejected, 'needs_review'), LATER);
      rejected.pullEvents();

      approved.decideManually(
        { outcome: 'approved', reason: ' Stable job ', decidedBy: 'ops-1' },
        LATER,
      );
      rejected.decideManually(
        { outcome: 'rejected', reason: 'Income unclear', decidedBy: 'ops-1' },
        LATER,
      );

      expect(approved.status).toBe('approved');
      expect(approved.manualDecision).toEqual({
        outcome: 'approved',
        reason: 'Stable job',
        decidedBy: 'ops-1',
        decidedAt: LATER,
      });
      expect(approved.pullEvents()[0]?.payload).toMatchObject({ decidedBy: 'ops' });
      expect(rejected.pullEvents()[0]?.payload).toMatchObject({
        reasons: ['Income unclear'],
        decidedBy: 'ops',
      });
    });

    it('should refuse a manual decision without a reason or outside review', () => {
      const inReview = anApplicationInScoring();
      inReview.decide(decisionOf(inReview, 'needs_review'), LATER);
      const approved = anApplicationInScoring();
      approved.decide(decisionOf(approved, 'approved'), LATER);

      expect(() => {
        inReview.decideManually({ outcome: 'approved', reason: '  ', decidedBy: 'ops-1' }, LATER);
      }).toThrow(InvalidValueError);
      expect(() => {
        approved.decideManually({ outcome: 'rejected', reason: 'No', decidedBy: 'ops-1' }, LATER);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('offer', () => {
    it('should hand lending the accepted terms', () => {
      const installments = anApplicationInScoring();
      installments.decide(decisionOf(installments, 'approved'), LATER);
      installments.pullEvents();
      const isa = anApplicationInScoring({ product: { kind: 'isa' } });
      isa.decide(decisionOf(isa, 'approved'), LATER);
      isa.pullEvents();

      installments.acceptOffer(LATER);
      isa.acceptOffer(LATER);

      expect(installments.status).toBe('offer_accepted');
      expect(installments.pullEvents()[0]?.payload).toMatchObject({
        amountCents: 750_000,
        product: { kind: 'installments', termMonths: 24, annualRateBasisPoints: 750 },
      });
      expect(isa.pullEvents()[0]?.payload).toMatchObject({
        product: { kind: 'isa', incomeShareBasisPoints: 1_000, capMultiplierHundredths: 150 },
      });
    });

    it('should only accept an approved offer', () => {
      expect(() => {
        anApplicationInScoring().acceptOffer(LATER);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('cancelling and expiring', () => {
    it('should cancel anything not final, once', () => {
      const application = aSubmittedApplication();

      application.cancel(LATER);

      expect(application.status).toBe('cancelled');
      expect(eventTypes(application)).toEqual([OriginationEvents.ApplicationCancelled]);
      expect(() => {
        application.cancel(LATER);
      }).toThrow(InvalidStateTransitionError);
    });

    it(`should expire after ${String(EXPIRY_DAYS)} days without moving, and not before`, () => {
      const application = aDraftApplication();
      const almost = new Date(NOW.getTime() + EXPIRY_DAYS * DAY_MS - 1);
      const due = new Date(NOW.getTime() + EXPIRY_DAYS * DAY_MS);

      expect(application.isStale(almost)).toBe(false);
      expect(() => {
        application.expire(almost);
      }).toThrow(InvalidStateTransitionError);
      application.expire(due);

      expect(application.status).toBe('expired');
      expect(application.pullEvents()[0]?.payload).toMatchObject({ expiredFrom: 'draft' });
      expect(application.isStale(new Date(due.getTime() + 30 * DAY_MS))).toBe(false);
    });

    it('should count from the last change of status', () => {
      const application = aDraftApplication();
      const submittedAt = new Date(NOW.getTime() + 10 * DAY_MS);
      application.submit(application.program, submittedAt);

      expect(application.isStale(new Date(NOW.getTime() + EXPIRY_DAYS * DAY_MS))).toBe(false);
      expect(application.isStale(new Date(submittedAt.getTime() + EXPIRY_DAYS * DAY_MS))).toBe(
        true,
      );
    });
  });
});
